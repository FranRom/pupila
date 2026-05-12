// Long-running poll-loop worker that drains data/apply-queue.json by running
// the AI Apply flow against each claimed job. Started by the user via
// `pnpm run apply-worker`, it is a separate Node process from the Vite dev
// server. The UI enqueues rows; this worker claims, runs the LLM, and writes
// results. Cancellation, orphan recovery, single-instance enforcement, and
// graceful shutdown are all handled here.
//
// console output is the intentional log channel for this worker — operators
// tail stdout from a terminal, so structured console.log/console.error calls
// below are deliberate, not stray debug.

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAiApplyForJob } from '../src/lib/ai-apply.js';
import {
  claimNext,
  isCancelled,
  markDone,
  markFailed,
  recoverOrphanedRunning,
} from '../src/lib/apply-queue.js';

// ---------------------------------------------------------------------------
// Paths — replicated from ui/plugins/_paths.ts to avoid src→ui coupling.
// scripts/apply-worker.ts → ../ resolves to the repo root.
// ---------------------------------------------------------------------------

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const APPLY_QUEUE_PATH = path.join(REPO_ROOT, 'data', 'apply-queue.json');
const APPLY_WORKER_PID_PATH = path.join(REPO_ROOT, 'data', 'apply-worker.pid');

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 1500;
const CANCEL_POLL_MS = 500;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function sleep(ms: number, signalPromise: Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signalPromise.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function writePidFile(pidPath: string): Promise<void> {
  await mkdir(path.dirname(pidPath), { recursive: true });
  const tmp = `${pidPath}.tmp`;
  await writeFile(tmp, String(process.pid), 'utf8');
  await rename(tmp, pidPath);
}

async function readExistingPid(pidPath: string): Promise<number | null> {
  try {
    const raw = await readFile(pidPath, 'utf8');
    const pid = Number.parseInt(raw.trim(), 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    // Signal 0 is the POSIX no-op existence check.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return false;
    // EPERM means the process exists but is owned by another user — still alive.
    if (code === 'EPERM') return true;
    return false;
  }
}

async function removePidFileQuietly(pidPath: string): Promise<void> {
  try {
    await unlink(pidPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      console.error('[shutdown] failed to remove pid file:', errMessage(err));
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // 1. Single-instance check
  const existingPid = await readExistingPid(APPLY_WORKER_PID_PATH);
  if (existingPid !== null) {
    if (isProcessAlive(existingPid)) {
      console.error(
        `[apply-worker] Another apply-worker is already running (pid=${existingPid}). Exiting.`,
      );
      process.exit(1);
    }
    console.log(`[apply-worker] Stale PID file (pid=${existingPid} not alive); cleaning up.`);
    await removePidFileQuietly(APPLY_WORKER_PID_PATH);
  }

  await writePidFile(APPLY_WORKER_PID_PATH);

  // 2. Recover any rows left in 'running' from a previous crash
  const recovered = await recoverOrphanedRunning(APPLY_QUEUE_PATH);
  if (recovered > 0) {
    console.log(`[apply-worker] Recovered ${recovered} orphaned 'running' row(s) → 'failed'.`);
  }

  // 3. Startup banner
  console.log('[apply-worker] started');
  console.log(`[apply-worker] pid=${process.pid}`);
  console.log(`[apply-worker] queue=${APPLY_QUEUE_PATH}`);
  console.log(`[apply-worker] pollInterval=${POLL_INTERVAL_MS}ms`);

  // 4. Shutdown plumbing
  let shouldExit = false;
  let currentController: AbortController | null = null;
  let forceCount = 0;
  let resolveSignalWait: (() => void) | null = null;
  let signalPromise = new Promise<void>((resolve) => {
    resolveSignalWait = resolve;
  });

  function fireSignalWait(): void {
    if (resolveSignalWait) {
      resolveSignalWait();
      resolveSignalWait = null;
    }
  }

  function handleSignal(signal: NodeJS.Signals): void {
    forceCount += 1;
    if (forceCount >= 2) {
      console.error(`[apply-worker] received ${signal} again — force exiting (1).`);
      process.exit(1);
    }
    console.log(`[apply-worker] received ${signal} — shutting down gracefully.`);
    shouldExit = true;
    if (currentController && !currentController.signal.aborted) {
      currentController.abort();
    }
    fireSignalWait();
  }

  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));

  // 5. Poll loop
  while (!shouldExit) {
    let claimed;
    try {
      claimed = await claimNext(APPLY_QUEUE_PATH);
    } catch (err) {
      console.error('[apply-worker] claimNext failed:', errMessage(err));
      await sleep(POLL_INTERVAL_MS, signalPromise);
      // refresh the signal promise after a wait
      if (!shouldExit) {
        signalPromise = new Promise<void>((resolve) => {
          resolveSignalWait = resolve;
        });
      }
      continue;
    }

    if (!claimed) {
      await sleep(POLL_INTERVAL_MS, signalPromise);
      if (!shouldExit) {
        signalPromise = new Promise<void>((resolve) => {
          resolveSignalWait = resolve;
        });
      }
      continue;
    }

    const { jobId, attempts } = claimed;
    console.log(`[claim] jobId=${jobId} attempts=${attempts}`);

    // If a SIGINT arrived during the await above, `shouldExit` is already true
    // but `currentController` was still null when handleSignal fired (the abort
    // was a no-op). Surface the claim as an orphan and bail before spawning the
    // LLM — recoverOrphanedRunning on next startup will re-flag it.
    if (shouldExit) {
      console.log(`[abort-on-claim] jobId=${jobId} — shutdown signaled mid-claim, leaving as running`);
      break;
    }

    const controller = new AbortController();
    currentController = controller;

    // Sub-poll: check if the UI flipped this row to 'cancelled'.
    let cancelDetected = false;
    const cancelInterval = setInterval(() => {
      isCancelled(jobId, APPLY_QUEUE_PATH)
        .then((cancelled) => {
          if (cancelled && !cancelDetected) {
            cancelDetected = true;
            console.log(`[cancel] jobId=${jobId} — UI requested cancel`);
            if (!controller.signal.aborted) {
              controller.abort();
            }
          }
        })
        .catch((err: unknown) => {
          console.error(`[cancel-poll] jobId=${jobId} isCancelled failed:`, errMessage(err));
        });
    }, CANCEL_POLL_MS);

    try {
      const result = await runAiApplyForJob({
        jobId,
        signal: controller.signal,
        onChunk: (chunk: string) => {
          process.stdout.write(chunk);
        },
      });

      if (result.ok) {
        const markResult = await markDone(jobId, result.applicationPath, APPLY_QUEUE_PATH);
        if (markResult.ok) {
          console.log(`[done] jobId=${jobId} path=${result.applicationPath}`);
        } else {
          console.warn(
            `[done] jobId=${jobId} but no running row found (reason=${markResult.reason}) — likely cancelled mid-LLM; partial output already on disk.`,
          );
        }
      } else if (result.reason === 'cancelled') {
        // The queue row is already 'cancelled' (UI flipped it). Don't double-mark.
        console.log(`[cancelled] jobId=${jobId} partialPath=${result.partialPath ?? 'none'}`);
      } else if (result.reason === 'empty-output') {
        await markFailed(jobId, 'LLM returned empty output', APPLY_QUEUE_PATH);
        console.log(`[failed/empty] jobId=${jobId}`);
      } else {
        // precondition
        await markFailed(jobId, result.message, APPLY_QUEUE_PATH);
        console.log(`[failed/precondition] jobId=${jobId} — ${result.message}`);
      }
    } catch (err) {
      const msg = errMessage(err);
      try {
        await markFailed(jobId, msg, APPLY_QUEUE_PATH);
      } catch (markErr) {
        console.error(
          `[apply-worker] markFailed itself failed for jobId=${jobId}:`,
          errMessage(markErr),
        );
      }
      console.error(`[failed/exception] jobId=${jobId} — ${msg}`);
    } finally {
      clearInterval(cancelInterval);
      currentController = null;
    }

    // Refresh signal promise for the next iteration's sleep (if we sleep).
    if (!shouldExit) {
      signalPromise = new Promise<void>((resolve) => {
        resolveSignalWait = resolve;
      });
    }
  }

  // 6. Clean shutdown
  await removePidFileQuietly(APPLY_WORKER_PID_PATH);
  console.log('[apply-worker] shutting down');
  process.exit(0);
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
