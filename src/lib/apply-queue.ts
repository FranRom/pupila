import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { lock } from 'proper-lockfile';

export type QueueRowStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export const VALID_QUEUE_STATUSES: ReadonlySet<QueueRowStatus> = new Set([
  'queued',
  'running',
  'done',
  'failed',
  'cancelled',
] as const);

export interface QueueRow {
  jobId: string;
  status: QueueRowStatus;
  enqueuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  cancelledAt?: string;
  attempts: number;
  error?: string;
  applicationPath?: string;
}

export interface QueueFile {
  version: 1;
  rows: QueueRow[];
}

const DEFAULT_PATH = 'data/apply-queue.json';
const EMPTY_QUEUE: QueueFile = { version: 1, rows: [] };

const TERMINAL_STATUSES: ReadonlySet<QueueRowStatus> = new Set([
  'done',
  'failed',
  'cancelled',
] as const);

function now(): string {
  return new Date().toISOString();
}

function isQueueRow(value: unknown): value is QueueRow {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.jobId === 'string' &&
    typeof v.status === 'string' &&
    VALID_QUEUE_STATUSES.has(v.status as QueueRowStatus) &&
    typeof v.enqueuedAt === 'string' &&
    typeof v.attempts === 'number'
  );
}

function isQueueFile(value: unknown): value is QueueFile {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || !Array.isArray(v.rows)) return false;
  return v.rows.every(isQueueRow);
}

async function ensureFileExists(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await readFile(filePath, 'utf8');
  } catch {
    await writeFile(filePath, JSON.stringify(EMPTY_QUEUE, null, 2), 'utf8');
  }
}

async function readQueue(filePath: string): Promise<QueueFile> {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (isQueueFile(parsed)) return parsed;
    return { ...EMPTY_QUEUE };
  } catch {
    return { ...EMPTY_QUEUE };
  }
}

async function writeQueue(filePath: string, queue: QueueFile): Promise<void> {
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, JSON.stringify(queue, null, 2), 'utf8');
  await rename(tmp, filePath);
}

// Holds an advisory lock for the whole R-M-W cycle so UI ↔ worker writes don't race.
async function withQueueLock<T>(
  filePath: string,
  fn: (queue: QueueFile) => Promise<{ next: QueueFile; result: T }>,
): Promise<T> {
  await ensureFileExists(filePath);

  const release = await lock(filePath, {
    retries: { retries: 5, minTimeout: 50, maxTimeout: 500, factor: 1.5 },
  });

  try {
    const queue = await readQueue(filePath);
    const { next, result } = await fn(queue);
    await writeQueue(filePath, next);
    return result;
  } finally {
    await release();
  }
}

export async function loadQueue(filePath: string = DEFAULT_PATH): Promise<QueueFile> {
  return readQueue(filePath);
}

export type EnqueueResult =
  | { ok: true; row: QueueRow }
  | { ok: false; reason: 'already-queued' | 'already-running' };

export async function enqueue(
  jobId: string,
  filePath: string = DEFAULT_PATH,
): Promise<EnqueueResult> {
  return withQueueLock<EnqueueResult>(filePath, async (queue) => {
    const existing = queue.rows.find(
      (r) => r.jobId === jobId && (r.status === 'queued' || r.status === 'running'),
    );

    if (existing) {
      const reason: 'already-queued' | 'already-running' =
        existing.status === 'queued' ? 'already-queued' : 'already-running';
      return { next: queue, result: { ok: false, reason } };
    }

    const row: QueueRow = {
      jobId,
      status: 'queued',
      enqueuedAt: now(),
      attempts: 0,
    };

    const next: QueueFile = { ...queue, rows: [...queue.rows, row] };
    return { next, result: { ok: true, row } };
  });
}

export async function claimNext(filePath: string = DEFAULT_PATH): Promise<QueueRow | null> {
  return withQueueLock(filePath, async (queue) => {
    const queued = queue.rows.filter((r) => r.status === 'queued');
    if (queued.length === 0) {
      return { next: queue, result: null };
    }

    // Oldest queued row by enqueuedAt
    const oldest = queued.reduce((prev, curr) => (curr.enqueuedAt < prev.enqueuedAt ? curr : prev));

    const updated: QueueRow = {
      ...oldest,
      status: 'running',
      startedAt: now(),
      attempts: oldest.attempts + 1,
    };

    const next: QueueFile = {
      ...queue,
      rows: queue.rows.map((r) => (r === oldest ? updated : r)),
    };

    return { next, result: updated };
  });
}

// Returned by markDone/markFailed. `ok: false` means no `running` row was
// found for that jobId — typically the row was cancelled between the worker
// reading it and reporting completion. Callers should log and continue.
export type MarkTerminalResult = { ok: true } | { ok: false; reason: 'no-running-row' };

export async function markDone(
  jobId: string,
  applicationPath: string,
  filePath: string = DEFAULT_PATH,
): Promise<MarkTerminalResult> {
  return withQueueLock<MarkTerminalResult>(filePath, async (queue) => {
    const runningRows = queue.rows.filter((r) => r.jobId === jobId && r.status === 'running');
    const target = runningRows[runningRows.length - 1];

    if (!target) {
      return { next: queue, result: { ok: false, reason: 'no-running-row' } };
    }

    const rows = queue.rows.map((r): QueueRow => {
      if (r === target) {
        return { ...r, status: 'done', finishedAt: now(), applicationPath };
      }
      return r;
    });

    return { next: { ...queue, rows }, result: { ok: true } };
  });
}

export async function markFailed(
  jobId: string,
  error: string,
  filePath: string = DEFAULT_PATH,
): Promise<MarkTerminalResult> {
  return withQueueLock<MarkTerminalResult>(filePath, async (queue) => {
    const runningRows = queue.rows.filter((r) => r.jobId === jobId && r.status === 'running');
    const target = runningRows[runningRows.length - 1];

    if (!target) {
      return { next: queue, result: { ok: false, reason: 'no-running-row' } };
    }

    const rows = queue.rows.map((r): QueueRow => {
      if (r === target) {
        return { ...r, status: 'failed', finishedAt: now(), error };
      }
      return r;
    });

    return { next: { ...queue, rows }, result: { ok: true } };
  });
}

export type MarkCancelledResult = { ok: true } | { ok: false; reason: 'not-found' | 'terminal' };

export async function markCancelled(
  jobId: string,
  filePath: string = DEFAULT_PATH,
): Promise<MarkCancelledResult> {
  return withQueueLock<MarkCancelledResult>(filePath, async (queue) => {
    const matching = queue.rows.filter((r) => r.jobId === jobId);
    if (matching.length === 0) {
      return { next: queue, result: { ok: false, reason: 'not-found' as const } };
    }

    const target = matching[matching.length - 1];
    if (!target) {
      return { next: queue, result: { ok: false, reason: 'not-found' as const } };
    }

    if (TERMINAL_STATUSES.has(target.status)) {
      return { next: queue, result: { ok: false, reason: 'terminal' as const } };
    }

    const cancelledAt = now();
    const rows = queue.rows.map((r): QueueRow => {
      if (r === target) {
        return { ...r, status: 'cancelled', cancelledAt };
      }
      return r;
    });

    return { next: { ...queue, rows }, result: { ok: true } };
  });
}

export async function recoverOrphanedRunning(filePath: string = DEFAULT_PATH): Promise<number> {
  return withQueueLock(filePath, async (queue) => {
    const orphaned = queue.rows.filter((r) => r.status === 'running');
    if (orphaned.length === 0) {
      return { next: queue, result: 0 };
    }

    const finishedAt = now();
    const rows = queue.rows.map((r): QueueRow => {
      if (r.status === 'running') {
        return { ...r, status: 'failed', finishedAt, error: 'orphaned: worker crashed mid-run' };
      }
      return r;
    });

    return { next: { ...queue, rows }, result: orphaned.length };
  });
}

export async function pruneOld(keepLast: number, filePath: string = DEFAULT_PATH): Promise<number> {
  return withQueueLock(filePath, async (queue) => {
    const terminal = queue.rows.filter((r) => TERMINAL_STATUSES.has(r.status));
    const active = queue.rows.filter((r) => !TERMINAL_STATUSES.has(r.status));

    if (terminal.length <= keepLast) {
      return { next: queue, result: 0 };
    }

    // Sort by enqueuedAt desc, keep the most recent `keepLast`
    const sorted = [...terminal].sort((a, b) => b.enqueuedAt.localeCompare(a.enqueuedAt));
    const keep = sorted.slice(0, keepLast);
    const dropped = terminal.length - keep.length;

    const rows: QueueRow[] = [...active, ...keep].sort((a, b) =>
      a.enqueuedAt.localeCompare(b.enqueuedAt),
    );

    return { next: { ...queue, rows }, result: dropped };
  });
}

export async function isCancelled(
  jobId: string,
  filePath: string = DEFAULT_PATH,
): Promise<boolean> {
  const queue = await readQueue(filePath);
  const matching = queue.rows.filter((r) => r.jobId === jobId);
  if (matching.length === 0) return false;
  const last = matching[matching.length - 1];
  return last?.status === 'cancelled';
}
