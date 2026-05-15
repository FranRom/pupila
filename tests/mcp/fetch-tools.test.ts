import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __resetFetchRunnerForTests } from '../../src/lib/fetch-runner.js';
import { getFetchStatusInputObject } from '../../src/mcp/schemas/fetch.js';
import { runGetFetchStatus } from '../../src/mcp/tools/get-fetch-status.js';
import { runTriggerFetch } from '../../src/mcp/tools/trigger-fetch.js';
import { parseToolJson } from './_fixtures.js';

interface TriggerSuccess {
  ok: true;
  runId: string;
  startedAt: string;
  state: {
    status: 'running';
    sources: Array<{ name: string; state: string; fetched?: number }>;
  };
}

interface TriggerAlreadyRunning {
  ok: false;
  reason: 'already-running';
  runId: string;
}

interface StatusResponse {
  state: {
    runId: string;
    status: 'running' | 'done' | 'error';
    exitCode: number | null;
    sources: Array<{ name: string; state: string; fetched?: number; errors?: number }>;
    lastError: string | null;
  };
}

// Stub spawn command — emits parser-compatible output for two known sources
// then exits 0. The runner picks this up as if pnpm exec tsx src/index.ts had
// run successfully. `sleep 0.01` between lines forces the parser to handle
// data in multiple chunks (one realistic failure mode).
const SUCCESS_SCRIPT = [
  'printf "[start] ashby\\n"',
  'sleep 0.02',
  'printf "[done] ashby fetched=42 errors=0\\n"',
  'printf "[start] lever\\n"',
  'sleep 0.02',
  'printf "[done] lever fetched=10 errors=2\\n"',
].join('; ');

async function waitUntilDone(runId: string, timeoutMs = 5_000): Promise<StatusResponse> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await runGetFetchStatus({ runId });
    const payload = parseToolJson(result.content) as StatusResponse;
    if (payload.state.status === 'done' || payload.state.status === 'error') {
      return payload;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timed out waiting for fetch to finish');
}

describe('trigger_fetch + get_fetch_status', () => {
  beforeEach(() => {
    __resetFetchRunnerForTests();
  });

  afterEach(() => {
    __resetFetchRunnerForTests();
  });

  it('returns a runId immediately with state.status = running', async () => {
    const result = await runTriggerFetch({
      command: 'bash',
      args: ['-c', SUCCESS_SCRIPT],
      mirrorToStdio: false,
    });
    const payload = parseToolJson(result.content) as TriggerSuccess;
    expect(payload.ok).toBe(true);
    expect(payload.runId).toMatch(/^[a-f0-9]{40}$/);
    expect(payload.state.status).toBe('running');
    await waitUntilDone(payload.runId); // drain so afterEach doesn't kill mid-run
  });

  it('returns already-running when called concurrently', async () => {
    const first = await runTriggerFetch({
      command: 'bash',
      args: ['-c', 'sleep 0.5'],
      mirrorToStdio: false,
    });
    const firstPayload = parseToolJson(first.content) as TriggerSuccess;

    const second = await runTriggerFetch({
      command: 'bash',
      args: ['-c', 'sleep 0.5'],
      mirrorToStdio: false,
    });
    const secondPayload = parseToolJson(second.content) as TriggerAlreadyRunning;
    expect(secondPayload.ok).toBe(false);
    expect(secondPayload.reason).toBe('already-running');
    expect(secondPayload.runId).toBe(firstPayload.runId);

    await waitUntilDone(firstPayload.runId);
  });

  it('parses [done] lines and reports exit 0 as status: done', async () => {
    const result = await runTriggerFetch({
      command: 'bash',
      args: ['-c', SUCCESS_SCRIPT],
      mirrorToStdio: false,
    });
    const payload = parseToolJson(result.content) as TriggerSuccess;
    const final = await waitUntilDone(payload.runId);
    expect(final.state.status).toBe('done');
    expect(final.state.exitCode).toBe(0);

    const ashby = final.state.sources.find((s) => s.name === 'ashby');
    expect(ashby?.state).toBe('done');
    expect(ashby?.fetched).toBe(42);
    expect(ashby?.errors).toBe(0);

    // errors>0 + fetched>0 → "partial" — partial sources are not a process
    // failure; the run as a whole is still 'done'.
    const lever = final.state.sources.find((s) => s.name === 'lever');
    expect(lever?.state).toBe('partial');
    expect(lever?.fetched).toBe(10);
    expect(lever?.errors).toBe(2);
  });

  it('reports status: error when the child exits non-zero', async () => {
    const result = await runTriggerFetch({
      command: 'bash',
      args: ['-c', 'echo "boom" >&2; exit 7'],
      mirrorToStdio: false,
    });
    const payload = parseToolJson(result.content) as TriggerSuccess;
    const final = await waitUntilDone(payload.runId);
    expect(final.state.status).toBe('error');
    expect(final.state.exitCode).toBe(7);
    expect(final.state.lastError).toContain('boom');
  });

  it('get_fetch_status returns error envelope for an unknown runId', async () => {
    // No run has been started.
    const result = await runGetFetchStatus({ runId: 'a'.repeat(40) });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('no run found');
  });

  it('get_fetch_status schema rejects malformed runId', () => {
    expect(getFetchStatusInputObject.safeParse({ runId: 'not-a-sha1' }).success).toBe(false);
    expect(getFetchStatusInputObject.safeParse({ runId: '../../../etc/passwd' }).success).toBe(
      false,
    );
    expect(getFetchStatusInputObject.safeParse({ runId: 'A'.repeat(40) }).success).toBe(false);
  });
});
