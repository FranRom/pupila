import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { safeHandler, toolError, toolJson } from '../../src/mcp/errors.js';

describe('toolJson', () => {
  it('wraps payload as a single text content with pretty-printed JSON', () => {
    const result = toolJson({ hello: 'world', n: 1 });
    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe('text');
    const text = result.content[0]?.text ?? '';
    expect(JSON.parse(text)).toEqual({ hello: 'world', n: 1 });
    expect(text).toContain('\n'); // pretty-printed
  });
});

describe('toolError', () => {
  it('returns an error envelope with isError: true and the message text', () => {
    const result = toolError('boom');
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe('boom');
  });
});

describe('safeHandler', () => {
  // Capture stderr writes so the test output stays clean and we can assert
  // logging behavior.
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it('passes through successful results unchanged', async () => {
    const ok = toolJson({ ok: true });
    const handler = safeHandler('demo', async () => ok);
    const result = await handler({});
    expect(result).toBe(ok);
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('catches a thrown Error and converts to error envelope', async () => {
    const handler = safeHandler('demo', async () => {
      throw new Error('disk full');
    });
    const result = await handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('demo failed: disk full');
    // STDERR receives the tagged log line.
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const written = stderrSpy.mock.calls[0]?.[0];
    expect(typeof written).toBe('string');
    expect(written as string).toContain('[mcp:demo] disk full');
  });

  it('handles non-Error throws with a generic message', async () => {
    const handler = safeHandler('demo', async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 'plain string';
    });
    const result = await handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('plain string');
  });

  it('handles thrown non-string non-Error values', async () => {
    const handler = safeHandler('demo', async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw { weird: true };
    });
    const result = await handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Unexpected error');
  });
});
