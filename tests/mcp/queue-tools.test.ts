import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { QueueRow } from '../../src/lib/apply-queue.js';
import { runCancelApply } from '../../src/mcp/tools/cancel-apply.js';
import { type EnqueueApplyPaths, runEnqueueApply } from '../../src/mcp/tools/enqueue-apply.js';
import { runQueueStatus } from '../../src/mcp/tools/queue-status.js';
import { runSkipJob } from '../../src/mcp/tools/skip-job.js';
import { runWorkerStatus } from '../../src/mcp/tools/worker-status.js';
import { buildFixture, type FixtureLayout, jobIdFor, makeJob, parseToolJson } from './_fixtures.js';

interface WorkerLiveness {
  alive: boolean;
  pid: number | null;
  pidPath: string;
}

function pathsFor(
  fx: FixtureLayout,
  overrides: Partial<EnqueueApplyPaths> = {},
): EnqueueApplyPaths {
  return {
    queuePath: path.join(fx.dir, 'apply-queue.json'),
    jobsPath: fx.jobsPath,
    workerPidPath: path.join(fx.dir, 'apply-worker.pid'),
    swipeSkipsPath: path.join(fx.dir, 'swipe-skips.json'),
    repoRoot: fx.dir,
    ...overrides,
  };
}

describe('queue tools', () => {
  let fx: FixtureLayout;
  const url = 'https://queue.example/job-x';
  let jobId: string;

  beforeEach(async () => {
    fx = await buildFixture({ jobs: [makeJob({ url })] });
    jobId = jobIdFor(url);
  });

  afterEach(async () => {
    if (fx) await fx.cleanup();
  });

  describe('worker_status', () => {
    it('reports alive: false when no PID file exists', async () => {
      const result = await runWorkerStatus({
        workerPidPath: path.join(fx.dir, 'no-pid'),
        repoRoot: fx.dir,
      });
      const w = parseToolJson(result.content) as WorkerLiveness;
      expect(w.alive).toBe(false);
      expect(w.pid).toBeNull();
    });

    it('reports alive: true when PID file points at this test process', async () => {
      const pidPath = path.join(fx.dir, 'worker.pid');
      await writeFile(pidPath, String(process.pid), 'utf8');
      const result = await runWorkerStatus({ workerPidPath: pidPath, repoRoot: fx.dir });
      const w = parseToolJson(result.content) as WorkerLiveness;
      expect(w.alive).toBe(true);
      expect(w.pid).toBe(process.pid);
    });

    it('reports stale when PID points at a process that no longer exists', async () => {
      // PID 1 is init/launchd; an extremely high integer that no process has.
      const pidPath = path.join(fx.dir, 'worker.pid');
      await writeFile(pidPath, '2147483646', 'utf8');
      const result = await runWorkerStatus({ workerPidPath: pidPath, repoRoot: fx.dir });
      const w = parseToolJson(result.content) as WorkerLiveness;
      expect(w.alive).toBe(false);
    });
  });

  describe('enqueue_apply', () => {
    it('enqueues a known jobId', async () => {
      const result = await runEnqueueApply({ jobId }, pathsFor(fx));
      const payload = parseToolJson(result.content) as {
        ok: boolean;
        row: QueueRow;
        worker: WorkerLiveness;
        warnings: string[];
      };
      expect(payload.ok).toBe(true);
      expect(payload.row.jobId).toBe(jobId);
      expect(payload.row.status).toBe('queued');
      expect(payload.warnings).toContainEqual(expect.stringContaining('apply-worker'));
    });

    it('rejects unknown jobId with a not-found error envelope', async () => {
      const ghost = 'a'.repeat(40);
      const result = await runEnqueueApply({ jobId: ghost }, pathsFor(fx));
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('not found');
    });

    it('returns already-queued error when called twice for the same job', async () => {
      await runEnqueueApply({ jobId }, pathsFor(fx));
      const second = await runEnqueueApply({ jobId }, pathsFor(fx));
      expect(second.isError).toBe(true);
      expect(second.content[0]?.text).toContain('already queued');
    });
  });

  describe('cancel_apply', () => {
    it('cancels a queued row (removes it)', async () => {
      await runEnqueueApply({ jobId }, pathsFor(fx));
      const result = await runCancelApply({ jobId }, { queuePath: pathsFor(fx).queuePath });
      const payload = parseToolJson(result.content) as { ok: boolean };
      expect(payload.ok).toBe(true);

      const status = await runQueueStatus({
        queuePath: pathsFor(fx).queuePath,
        workerPidPath: path.join(fx.dir, 'no-pid'),
        repoRoot: fx.dir,
      });
      const queue = parseToolJson(status.content) as { rows: QueueRow[] };
      expect(queue.rows).toHaveLength(0);
    });

    it('returns not-found error for jobId that was never enqueued', async () => {
      const result = await runCancelApply({ jobId }, { queuePath: pathsFor(fx).queuePath });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('no queue row');
    });
  });

  describe('skip_job', () => {
    it('persists the jobId to swipe-skips.json', async () => {
      const result = await runSkipJob({ jobId }, { swipeSkipsPath: pathsFor(fx).swipeSkipsPath });
      const payload = parseToolJson(result.content) as { ok: boolean; jobId: string };
      expect(payload.ok).toBe(true);
      expect(payload.jobId).toBe(jobId);
    });

    it('is idempotent — calling twice does not error', async () => {
      const skipPath = pathsFor(fx).swipeSkipsPath;
      await runSkipJob({ jobId }, { swipeSkipsPath: skipPath });
      const second = await runSkipJob({ jobId }, { swipeSkipsPath: skipPath });
      expect(second.isError).toBeUndefined();
    });
  });

  describe('queue_status', () => {
    it('returns empty rows + worker liveness when queue is fresh', async () => {
      const result = await runQueueStatus({
        queuePath: pathsFor(fx).queuePath,
        workerPidPath: path.join(fx.dir, 'no-pid'),
        repoRoot: fx.dir,
      });
      const payload = parseToolJson(result.content) as {
        rows: QueueRow[];
        worker: WorkerLiveness;
      };
      expect(payload.rows).toEqual([]);
      expect(payload.worker.alive).toBe(false);
    });

    it('reflects enqueued rows', async () => {
      await runEnqueueApply({ jobId }, pathsFor(fx));
      const result = await runQueueStatus({
        queuePath: pathsFor(fx).queuePath,
        workerPidPath: path.join(fx.dir, 'no-pid'),
        repoRoot: fx.dir,
      });
      const payload = parseToolJson(result.content) as { rows: QueueRow[] };
      expect(payload.rows).toHaveLength(1);
      expect(payload.rows[0]?.jobId).toBe(jobId);
    });
  });
});
