import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Point the plugin at a throwaway file — never the real data/favorites.json.
const state = vi.hoisted(() => ({ path: '' }));
vi.mock('../../plugins/_paths.ts', () => ({
  get FAVORITES_PATH() {
    return state.path;
  },
}));

import { favoritesApiPlugin } from '../../plugins/favorites.ts';

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

const ID_A = 'a'.repeat(40);
const ID_B = 'b'.repeat(40);

let dir = '';
let handler: Handler;
let prefix = '';

function call(method: string, url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    const res = {
      statusCode: 200,
      setHeader: (k: string, v: string) => {
        headers[k] = v;
      },
      end: (body?: string) => resolve({ status: res.statusCode, body: body ?? '' }),
    } as unknown as ServerResponse;
    handler({ method, url } as IncomingMessage, res).catch(reject);
  });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pupila-fav-'));
  state.path = join(dir, 'favorites.json');
  const plugin = favoritesApiPlugin();
  const configure = plugin.configureServer as (server: unknown) => void;
  configure({
    middlewares: {
      use: (p: string, h: Handler) => {
        prefix = p;
        handler = h;
      },
    },
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe('favorites API plugin', () => {
  it('mounts under /api/favorites', () => {
    expect(prefix).toBe('/api/favorites');
  });

  it('GET / is empty before anything is favorited', async () => {
    const r = await call('GET', '/');
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ favorites: [] });
  });

  it('GET / flags a damaged file instead of silently listing nothing', async () => {
    await writeFile(state.path, '{"favorites": [ {"jobId": "x"');
    const r = await call('GET', '/');
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ favorites: [], damaged: true });
  });

  it('POST /<id> persists a favorite and GET lists it', async () => {
    expect((await call('POST', `/${ID_A}`)).status).toBe(200);
    expect((await call('POST', `/${ID_B}`)).status).toBe(200);
    const listed = JSON.parse((await call('GET', '/')).body) as { favorites: string[] };
    expect([...listed.favorites].sort()).toEqual([ID_A, ID_B]);
    const onDisk = await readFile(state.path, 'utf8');
    expect(onDisk).toContain(ID_A);
  });

  it('POST is idempotent', async () => {
    await call('POST', `/${ID_A}`);
    await call('POST', `/${ID_A}`);
    const listed = JSON.parse((await call('GET', '/')).body) as { favorites: string[] };
    expect(listed.favorites).toEqual([ID_A]);
  });

  it('DELETE /<id> removes only that favorite', async () => {
    await call('POST', `/${ID_A}`);
    await call('POST', `/${ID_B}`);
    expect((await call('DELETE', `/${ID_A}`)).status).toBe(200);
    const listed = JSON.parse((await call('GET', '/')).body) as { favorites: string[] };
    expect(listed.favorites).toEqual([ID_B]);
  });

  it('ignores a query string when routing', async () => {
    expect((await call('GET', '/?x=1')).status).toBe(200);
  });

  it.each(['POST', 'DELETE'])('%s rejects an id that is not sha1 hex with 400', async (method) => {
    for (const bad of [
      '/not-a-hash',
      '/../../etc/passwd',
      `/${'z'.repeat(40)}`,
      `/${'a'.repeat(39)}`,
    ]) {
      const r = await call(method, bad);
      expect(r.status).toBe(400);
      expect(JSON.parse(r.body).error).toMatch(/jobId/);
    }
  });

  it('rejects unsupported methods with 405', async () => {
    expect((await call('PUT', `/${ID_A}`)).status).toBe(405);
    expect((await call('POST', '/')).status).toBe(405);
  });

  it('turns a storage failure into a 500 JSON error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // A path "inside" a regular file can never be created.
    const blocker = join(dir, 'blocker');
    await writeFile(blocker, 'x');
    state.path = join(blocker, 'favorites.json');
    const r = await call('POST', `/${ID_A}`);
    expect(r.status).toBe(500);
    expect(JSON.parse(r.body).error).toEqual(expect.any(String));
  });
});
