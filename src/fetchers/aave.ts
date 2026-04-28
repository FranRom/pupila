import type { FetcherResult, RawAavePost } from '../types.js';
import { fetchText, HTML_HEADERS } from '../utils.js';

const CAREERS_URL = 'https://aave.com/careers';
const NEXT_DATA_RE = /<script id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/;

export function parseAaveHtml(html: string): RawAavePost[] {
  const m = html.match(NEXT_DATA_RE);
  if (!m?.[1]) return [];
  let data: unknown;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return [];
  }
  const posts = (data as { props?: { pageProps?: { posts?: RawAavePost[] } } })?.props?.pageProps
    ?.posts;
  return Array.isArray(posts) ? posts : [];
}

export async function fetchAave(): Promise<FetcherResult<RawAavePost>> {
  try {
    const html = await fetchText(CAREERS_URL, { headers: HTML_HEADERS });
    return { items: parseAaveHtml(html), errors: [] };
  } catch (err) {
    const message = (err as Error).message;
    console.error('[aave]', message);
    return { items: [], errors: [message] };
  }
}
