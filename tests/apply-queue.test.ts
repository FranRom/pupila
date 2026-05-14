import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  claimNext,
  enqueue,
  isCancelled,
  loadQueue,
  markCancelled,
  markDone,
  markFailed,
  pruneOld,
  recoverOrphanedRunning,
} from '../src/lib/apply-queue.js';

let tmpDir: string;
let queuePath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apply-queue-test-'));
  queuePath = path.join(tmpDir, 'apply-queue.json');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('loadQueue', () => {
  it('returns empty queue when file does not exist', async () => {
    const result = await loadQueue(queuePath);
    expect(result).toEqual({ version: 1, rows: [] });
  });

  it('returns empty queue when file contains malformed JSON', async () => {
    await fs.writeFile(queuePath, '{ not valid json !!!', 'utf8');
    const result = await loadQueue(queuePath);
    expect(result).toEqual({ version: 1, rows: [] });
  });

  it('returns parsed queue when file is valid', async () => {
    const data = {
      version: 1,
      rows: [
        { jobId: 'abc', status: 'queued', enqueuedAt: '2026-05-11T00:00:00.000Z', attempts: 0 },
      ],
    };
    await fs.writeFile(queuePath, JSON.stringify(data), 'utf8');
    const result = await loadQueue(queuePath);
    expect(result.version).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.jobId).toBe('abc');
  });
});

describe('enqueue', () => {
  it('creates the first row with correct fields', async () => {
    const before = Date.now();
    const result = await enqueue('job-1', queuePath);
    const after = Date.now();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.row.jobId).toBe('job-1');
    expect(result.row.status).toBe('queued');
    expect(result.row.attempts).toBe(0);

    const enqueuedMs = new Date(result.row.enqueuedAt).getTime();
    expect(enqueuedMs).toBeGreaterThanOrEqual(before);
    expect(enqueuedMs).toBeLessThanOrEqual(after);

    expect(result.row.enqueuedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('rejects duplicate enqueue when first row is queued', async () => {
    await enqueue('job-1', queuePath);
    const second = await enqueue('job-1', queuePath);

    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('expected rejection');
    expect(second.reason).toBe('already-queued');
  });

  it('rejects enqueue when a running row exists for jobId', async () => {
    await enqueue('job-1', queuePath);
    await claimNext(queuePath);
    const second = await enqueue('job-1', queuePath);

    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('expected rejection');
    expect(second.reason).toBe('already-running');
  });

  it('succeeds when a done historical row exists for jobId', async () => {
    await enqueue('job-1', queuePath);
    await claimNext(queuePath);
    await markDone('job-1', 'data/applications/job-1.md', queuePath);

    const second = await enqueue('job-1', queuePath);
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error('expected ok');
    expect(second.row.status).toBe('queued');

    const q = await loadQueue(queuePath);
    expect(q.rows).toHaveLength(2);
  });
});

describe('claimNext', () => {
  it('returns null on empty queue', async () => {
    const result = await claimNext(queuePath);
    expect(result).toBeNull();
  });

  it('returns null when only running/done rows remain', async () => {
    await enqueue('job-1', queuePath);
    await claimNext(queuePath); // claims job-1, now running

    const result = await claimNext(queuePath);
    expect(result).toBeNull();
  });

  it('picks the OLDEST queued row', async () => {
    await enqueue('job-A', queuePath);
    // Small delay to ensure enqueuedAt differs
    await new Promise((r) => setTimeout(r, 5));
    await enqueue('job-B', queuePath);

    const claimed = await claimNext(queuePath);
    expect(claimed?.jobId).toBe('job-A');
  });

  it('transitions queued→running and increments attempts', async () => {
    await enqueue('job-1', queuePath);
    const claimed = await claimNext(queuePath);

    expect(claimed).not.toBeNull();
    expect(claimed?.status).toBe('running');
    expect(claimed?.attempts).toBe(1);
    expect(claimed?.startedAt).toBeDefined();
    expect(claimed?.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('persists the running state to disk', async () => {
    await enqueue('job-1', queuePath);
    await claimNext(queuePath);

    const q = await loadQueue(queuePath);
    expect(q.rows[0]?.status).toBe('running');
    expect(q.rows[0]?.attempts).toBe(1);
  });
});

describe('markDone', () => {
  it('flips running→done with applicationPath and finishedAt', async () => {
    await enqueue('job-1', queuePath);
    await claimNext(queuePath);
    const result = await markDone('job-1', 'data/applications/job-1.md', queuePath);

    expect(result).toEqual({ ok: true });
    const q = await loadQueue(queuePath);
    const row = q.rows[0];
    expect(row?.status).toBe('done');
    expect(row?.applicationPath).toBe('data/applications/job-1.md');
    expect(row?.finishedAt).toBeDefined();
    expect(row?.finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('returns {ok:false} when no running row exists (e.g. cancelled mid-run)', async () => {
    await enqueue('job-1', queuePath);
    await claimNext(queuePath); // running
    await markCancelled('job-1', queuePath); // running → cancelled

    const result = await markDone('job-1', 'data/applications/job-1.md', queuePath);
    expect(result).toEqual({ ok: false, reason: 'no-running-row' });

    const q = await loadQueue(queuePath);
    expect(q.rows[0]?.status).toBe('cancelled');
  });

  it('returns {ok:false} for unknown jobId', async () => {
    const result = await markDone('does-not-exist', 'data/applications/x.md', queuePath);
    expect(result).toEqual({ ok: false, reason: 'no-running-row' });
  });
});

describe('markFailed', () => {
  it('flips running→failed with error and finishedAt', async () => {
    await enqueue('job-1', queuePath);
    await claimNext(queuePath);
    const result = await markFailed('job-1', 'LLM timeout', queuePath);

    expect(result).toEqual({ ok: true });
    const q = await loadQueue(queuePath);
    const row = q.rows[0];
    expect(row?.status).toBe('failed');
    expect(row?.error).toBe('LLM timeout');
    expect(row?.finishedAt).toBeDefined();
  });

  it('returns {ok:false} when no running row exists', async () => {
    const result = await markFailed('does-not-exist', 'error', queuePath);
    expect(result).toEqual({ ok: false, reason: 'no-running-row' });
  });
});

describe('markCancelled', () => {
  it('removes a queued row entirely and returns {ok:true}', async () => {
    // Queued rows haven't started running — cancelling them removes the row
    // so it doesn't clutter the Failed tab with audit-trail noise.
    await enqueue('job-1', queuePath);
    const result = await markCancelled('job-1', queuePath);

    expect(result).toEqual({ ok: true });

    const q = await loadQueue(queuePath);
    expect(q.rows).toHaveLength(0);
  });

  it('cancels a running row and returns {ok:true}', async () => {
    await enqueue('job-1', queuePath);
    await claimNext(queuePath);
    const result = await markCancelled('job-1', queuePath);

    expect(result).toEqual({ ok: true });

    const q = await loadQueue(queuePath);
    expect(q.rows[0]?.status).toBe('cancelled');
  });

  it('returns {ok:false, reason:"terminal"} for a done row', async () => {
    await enqueue('job-1', queuePath);
    await claimNext(queuePath);
    await markDone('job-1', 'data/applications/job-1.md', queuePath);

    const result = await markCancelled('job-1', queuePath);
    expect(result).toEqual({ ok: false, reason: 'terminal' });

    // Row unchanged
    const q = await loadQueue(queuePath);
    expect(q.rows[0]?.status).toBe('done');
  });

  it('returns {ok:false, reason:"not-found"} for unknown jobId', async () => {
    const result = await markCancelled('nonexistent', queuePath);
    expect(result).toEqual({ ok: false, reason: 'not-found' });
  });

  it('returns {ok:false, reason:"terminal"} for a failed row', async () => {
    await enqueue('job-1', queuePath);
    await claimNext(queuePath);
    await markFailed('job-1', 'error', queuePath);

    const result = await markCancelled('job-1', queuePath);
    expect(result).toEqual({ ok: false, reason: 'terminal' });
  });

  it('returns {ok:false, reason:"not-found"} after cancelling a queued row (row is gone)', async () => {
    await enqueue('job-1', queuePath);
    await markCancelled('job-1', queuePath); // queued → removed

    const result = await markCancelled('job-1', queuePath);
    expect(result).toEqual({ ok: false, reason: 'not-found' });
  });

  it('returns {ok:false, reason:"terminal"} for an already-cancelled running row', async () => {
    await enqueue('job-1', queuePath);
    await claimNext(queuePath); // running
    await markCancelled('job-1', queuePath); // running → cancelled (kept)

    const result = await markCancelled('job-1', queuePath);
    expect(result).toEqual({ ok: false, reason: 'terminal' });
  });
});

describe('recoverOrphanedRunning', () => {
  it('marks all running rows as failed with orphan message', async () => {
    await enqueue('job-1', queuePath);
    await enqueue('job-2', queuePath);
    await claimNext(queuePath); // job-1 running
    await claimNext(queuePath); // job-2 running

    const count = await recoverOrphanedRunning(queuePath);
    expect(count).toBe(2);

    const q = await loadQueue(queuePath);
    for (const row of q.rows) {
      expect(row.status).toBe('failed');
      expect(row.error).toBe('orphaned: worker crashed mid-run');
    }
  });

  it('returns 0 when no running rows exist', async () => {
    await enqueue('job-1', queuePath);
    const count = await recoverOrphanedRunning(queuePath);
    expect(count).toBe(0);

    const q = await loadQueue(queuePath);
    expect(q.rows[0]?.status).toBe('queued');
  });
});

describe('pruneOld', () => {
  it('keeps queued and running rows, drops old terminal rows beyond keepLast', async () => {
    // Create 3 done rows + 1 queued
    for (let i = 1; i <= 3; i++) {
      await enqueue(`job-${i}`, queuePath);
      await claimNext(queuePath);
      await markDone(`job-${i}`, `data/applications/job-${i}.md`, queuePath);
      await new Promise((r) => setTimeout(r, 5));
    }
    await enqueue('job-4', queuePath); // queued

    const dropped = await pruneOld(1, queuePath);
    expect(dropped).toBe(2); // 3 done rows, keep 1 most recent → drop 2

    const q = await loadQueue(queuePath);
    const doneRows = q.rows.filter((r) => r.status === 'done');
    const queuedRows = q.rows.filter((r) => r.status === 'queued');
    expect(doneRows).toHaveLength(1);
    expect(queuedRows).toHaveLength(1);
  });

  it('returns 0 when terminal rows are within keepLast', async () => {
    await enqueue('job-1', queuePath);
    await claimNext(queuePath);
    await markDone('job-1', 'data/applications/job-1.md', queuePath);

    const dropped = await pruneOld(5, queuePath);
    expect(dropped).toBe(0);
  });
});

describe('isCancelled', () => {
  it('returns false for a queued row', async () => {
    await enqueue('job-1', queuePath);
    expect(await isCancelled('job-1', queuePath)).toBe(false);
  });

  it('returns true for a cancelled running row', async () => {
    await enqueue('job-1', queuePath);
    await claimNext(queuePath);
    await markCancelled('job-1', queuePath);
    expect(await isCancelled('job-1', queuePath)).toBe(true);
  });

  it('returns false after cancelling a queued row (row removed, not cancelled)', async () => {
    await enqueue('job-1', queuePath);
    await markCancelled('job-1', queuePath);
    expect(await isCancelled('job-1', queuePath)).toBe(false);
  });

  it('returns false for unknown jobId', async () => {
    expect(await isCancelled('nonexistent', queuePath)).toBe(false);
  });

  it('checks the most recent row for jobId', async () => {
    // First row: done
    await enqueue('job-1', queuePath);
    await claimNext(queuePath);
    await markDone('job-1', 'data/applications/job-1.md', queuePath);

    // Second row: queued (not cancelled)
    await enqueue('job-1', queuePath);

    expect(await isCancelled('job-1', queuePath)).toBe(false);
  });
});

describe('concurrent enqueue', () => {
  it('handles concurrent enqueues without JSON corruption', async () => {
    const results = await Promise.all([
      enqueue('job-A', queuePath),
      enqueue('job-B', queuePath),
      enqueue('job-C', queuePath),
    ]);

    const successes = results.filter((r) => r.ok);
    expect(successes).toHaveLength(3);

    const q = await loadQueue(queuePath);
    // File must be valid JSON with all 3 rows
    expect(q.rows).toHaveLength(3);
    const jobIds = q.rows.map((r) => r.jobId).sort();
    expect(jobIds).toEqual(['job-A', 'job-B', 'job-C']);
  });
});
