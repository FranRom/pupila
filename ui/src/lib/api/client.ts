/*
 * Low-level HTTP client with discriminated-union error handling.
 *
 * Every call returns Result<T, ApiError> — call sites match exhaustively on
 * `r.ok` and the type narrows the rest. The four error kinds cover everything
 * a request can fail with:
 *   - http     non-2xx response (status + statusText + best-effort body)
 *   - network  fetch threw (offline, DNS, CORS, etc.)
 *   - abort    caller's AbortSignal fired
 *   - parse    server returned non-JSON when JSON was expected
 *
 * Centralizing error mapping here means UI callers never write the same
 * "if (!res.ok) try { res.text() } catch …" boilerplate, and never silently
 * drop a parse failure.
 */

export type ApiError =
  | { kind: 'http'; status: number; statusText: string; body: string }
  | { kind: 'network'; message: string }
  | { kind: 'abort' }
  | { kind: 'parse'; message: string };

export type Result<T> = { ok: true; value: T } | { ok: false; error: ApiError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T>(error: ApiError): Result<T> {
  return { ok: false, error };
}

/**
 * Render an ApiError to a human-readable string. Use this when surfacing
 * errors to the user (`setError(formatError(r.error))`) rather than
 * reconstructing the message at every call site.
 */
export function formatError(error: ApiError): string {
  switch (error.kind) {
    case 'http': {
      const trailer = error.body ? ` — ${error.body.slice(0, 200)}` : '';
      return `HTTP ${error.status} ${error.statusText}${trailer}`;
    }
    case 'network':
      return error.message;
    case 'abort':
      return 'Request aborted.';
    case 'parse':
      return `Bad server response: ${error.message}`;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE' | 'PUT';
  /** JSON body — pass an object, not a stringified one. */
  json?: unknown;
  /** Raw body for non-JSON uploads (e.g. multipart FormData passthrough). */
  body?: BodyInit;
  signal?: AbortSignal;
  /** Skip JSON parsing — useful for endpoints that return 204 / text / blob. */
  expectJson?: boolean;
}

/**
 * Core request helper. Returns Result<T> — never throws (except for
 * programmer errors like a malformed URL, which surface as a runtime error
 * and are not part of the API surface). Cancellation via AbortSignal is
 * mapped to `{ kind: 'abort' }` so cleanup effects can branch on it without
 * special-casing `error.name === 'AbortError'` in every consumer.
 */
export async function request<T>(path: string, opts: RequestOptions = {}): Promise<Result<T>> {
  const { method = 'GET', json, body, signal, expectJson = true } = opts;
  const headers: Record<string, string> = {};
  let init: RequestInit = { method, signal };
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    init = { ...init, body: JSON.stringify(json) };
  } else if (body !== undefined) {
    init = { ...init, body };
  }
  init.headers = headers;

  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'AbortError') return err({ kind: 'abort' });
    return err({ kind: 'network', message: e instanceof Error ? e.message : 'fetch failed' });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return err({
      kind: 'http',
      status: res.status,
      statusText: res.statusText,
      body: text,
    });
  }

  if (!expectJson) {
    // Caller treats success as "any 2xx" — no parsed value to return.
    return ok(undefined as T);
  }

  try {
    const data = (await res.json()) as T;
    return ok(data);
  } catch (e: unknown) {
    return err({ kind: 'parse', message: e instanceof Error ? e.message : 'invalid JSON' });
  }
}

/**
 * Build a path with a URL-encoded segment safely.
 * `path('/api/job-body', jobId)` → `/api/job-body/<encoded>`
 */
export function path(prefix: string, ...segments: string[]): string {
  return [prefix, ...segments.map(encodeURIComponent)].join('/');
}
