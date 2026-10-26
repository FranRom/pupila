import type { ServerResponse } from 'node:http';

// Dependency-free HTTP helpers shared by the Vite middleware plugins. Kept out of
// `_shared.ts` so a plugin that only needs these does not pull in the CV parser,
// LLM and preferences modules (and their import-time side effects).

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

// Strip the registration prefix off `req.url` (already removed by Connect)
// down to just the leading slash + path. Drops any query string.
export function pathnameOf(rawUrl: string | undefined): string {
  if (!rawUrl) return '/';
  const q = rawUrl.indexOf('?');
  return q === -1 ? rawUrl : rawUrl.slice(0, q);
}
