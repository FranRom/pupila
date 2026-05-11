import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { streamableResponse } from '../src/lib/streamable-response.js';

function makeReq(accept: string): IncomingMessage {
  return { headers: { accept } } as unknown as IncomingMessage;
}

interface FakeRes {
  headers: Record<string, string>;
  statusCode: number;
  body: string;
  ended: boolean;
}

function makeRes(): { res: ServerResponse; fake: FakeRes } {
  const fake: FakeRes = { headers: {}, statusCode: 200, body: '', ended: false };
  const res = {
    setHeader(k: string, v: string) {
      fake.headers[k] = v;
    },
    write(s: string) {
      fake.body += s;
      return true;
    },
    end(s?: string) {
      if (typeof s === 'string') fake.body += s;
      fake.ended = true;
    },
    get statusCode() {
      return fake.statusCode;
    },
    set statusCode(v: number) {
      fake.statusCode = v;
    },
  } as unknown as ServerResponse;
  return { res, fake };
}

describe('streamableResponse', () => {
  it('JSON mode: finish() sends ok+payload, intermediate send() is a no-op', () => {
    const { res, fake } = makeRes();
    const r = streamableResponse(makeReq('application/json'), res);
    expect(r.isStreaming).toBe(false);
    r.send({ type: 'chunk', data: 'ignored in JSON mode' });
    r.finish({ body: 'hello' });
    expect(fake.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(fake.body)).toEqual({ ok: true, body: 'hello' });
    expect(fake.ended).toBe(true);
  });

  it('JSON mode: fail() sends error JSON with custom status', () => {
    const { res, fake } = makeRes();
    const r = streamableResponse(makeReq(''), res);
    r.fail('boom', 502);
    expect(fake.statusCode).toBe(502);
    expect(fake.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(fake.body)).toEqual({ error: 'boom' });
  });

  it('NDJSON mode: send() emits one JSON line per call', () => {
    const { res, fake } = makeRes();
    const r = streamableResponse(makeReq('application/x-ndjson'), res);
    expect(r.isStreaming).toBe(true);
    expect(fake.headers['Content-Type']).toBe('application/x-ndjson');
    expect(fake.headers['Cache-Control']).toBe('no-cache');
    r.send({ type: 'start', stage: 'parsing-cv' });
    r.send({ type: 'chunk', data: 'hello' });
    r.finish({ body: 'hello world' });
    const lines = fake.body
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines).toEqual([
      { type: 'start', stage: 'parsing-cv' },
      { type: 'chunk', data: 'hello' },
      { type: 'done', body: 'hello world' },
    ]);
    expect(fake.ended).toBe(true);
  });

  it('NDJSON mode: fail() emits a terminal error event regardless of status arg', () => {
    const { res, fake } = makeRes();
    const r = streamableResponse(makeReq('application/x-ndjson'), res);
    r.send({ type: 'chunk', data: 'partial' });
    r.fail('oops', 500); // status ignored — headers already sent
    const lines = fake.body
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines).toEqual([
      { type: 'chunk', data: 'partial' },
      { type: 'error', error: 'oops' },
    ]);
    expect(fake.ended).toBe(true);
  });

  it('NDJSON mode: tolerates an Accept header that lists multiple types', () => {
    const { res, fake } = makeRes();
    const r = streamableResponse(makeReq('application/json, application/x-ndjson'), res);
    expect(r.isStreaming).toBe(true);
    r.finish({ ok: 1 });
    expect(fake.body).toContain('"type":"done"');
  });
});
