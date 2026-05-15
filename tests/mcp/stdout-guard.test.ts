import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The stdout-guard module patches console.* on import. We re-import it in
// each test via vi.resetModules in afterEach so each test gets a fresh
// import — order matters: console.* restoration happens in afterEach BEFORE
// vi.resetModules, so the next test starts with pristine console methods.
// If a future test calls console.* outside an it() block (e.g. in a
// describe-scoped hook), the patch won't be active yet — keep that in mind.
describe('stdout-guard', () => {
  let stderrWrites: string[];
  let stdoutWrites: string[];
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let originalLog: typeof console.log;
  let originalInfo: typeof console.info;
  let originalWarn: typeof console.warn;

  beforeEach(() => {
    stderrWrites = [];
    stdoutWrites = [];
    originalLog = console.log;
    originalInfo = console.info;
    originalWarn = console.warn;
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrWrites.push(String(chunk));
      return true;
    });
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutWrites.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    console.log = originalLog;
    console.info = originalInfo;
    console.warn = originalWarn;
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
    vi.resetModules();
  });

  it('redirects console.log to stderr instead of stdout', async () => {
    await import('../../src/mcp/lib/stdout-guard.js');
    console.log('hello mcp');
    expect(stderrWrites.join('')).toContain('hello mcp');
    expect(stdoutWrites.join('')).not.toContain('hello mcp');
  });

  it('tags console.info and console.warn so origin is obvious in logs', async () => {
    await import('../../src/mcp/lib/stdout-guard.js');
    console.info('an info line');
    console.warn('a warn line');
    const joined = stderrWrites.join('');
    expect(joined).toContain('[info] an info line');
    expect(joined).toContain('[warn] a warn line');
    expect(stdoutWrites.join('')).toBe('');
  });

  it('serializes non-string args via JSON.stringify', async () => {
    await import('../../src/mcp/lib/stdout-guard.js');
    console.log({ payload: 'x', n: 7 });
    expect(stderrWrites.join('')).toContain('{"payload":"x","n":7}');
  });
});
