import type { FetcherResult, RawHnComment, RawHnHiringPost, RawHnHit } from '../types.js';
import { fetchJson, JSON_HEADERS } from '../utils.js';

// The monthly threads are all posted by the `whoishiring` account on the 1st, so
// scoping the search to that author is exact — no unrelated story can crowd the
// window. Verified against "Ask HN: Who is hiring? (July 2026)" (item 48747976),
// whose author is `whoishiring`.
const AUTHOR_URL =
  'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=20';

// Fallback for the day the account changes or its author index lags: the
// original free-text query, over a window wide enough to still contain a
// month-old thread.
//
// THE BUG THIS FIXES. The only query used to be the free-text one at
// `hitsPerPage=5`, date-sorted across every story on HN. The monthly thread was
// therefore reachable on the 1st and fell out of the window within days; for the
// rest of the month `pickLatestHiringStory` found no candidate and the source
// returned zero items. Silent by construction — a source returning 0 looks
// exactly like a quiet day, which is why it went unnoticed.
const FALLBACK_URL =
  'https://hn.algolia.com/api/v1/search_by_date?query=Ask+HN+Who+is+hiring&tags=story&hitsPerPage=50';

const itemUrl = (id: number) => `https://hn.algolia.com/api/v1/items/${id}`;

interface SearchResponse {
  hits: RawHnHit[];
}

interface ItemTree extends RawHnComment {
  children?: ItemTree[];
}

/**
 * Newest story whose title is a "Who is hiring?" thread. The regex deliberately
 * does not match the sibling "Who wants to be hired?" thread, which the same
 * account posts in the same second.
 *
 * Exported for tests: the windowing regression above is invisible end-to-end,
 * since it surfaces as an empty result rather than a failure.
 */
export function pickLatestHiringStory(hits: RawHnHit[]): RawHnHit | null {
  const candidates = hits.filter((h) => /who\s+is\s+hiring/i.test(h.title ?? ''));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return candidates[0] ?? null;
}

export async function fetchHnHiring(): Promise<FetcherResult<RawHnHiringPost>> {
  try {
    let story: RawHnHit | null = null;
    const errors: string[] = [];

    for (const url of [AUTHOR_URL, FALLBACK_URL]) {
      try {
        const search = await fetchJson<SearchResponse>(url, { headers: JSON_HEADERS });
        story = pickLatestHiringStory(search.hits ?? []);
        if (story) break;
      } catch (err) {
        // A failing primary must not stop the fallback being tried.
        const label = url === AUTHOR_URL ? 'author query' : 'fallback query';
        errors.push(`${label}: ${(err as Error).message}`);
      }
    }

    if (!story) {
      const message = 'no matching "Who is hiring" story found (author query and fallback)';
      console.error('[hn-hiring]', message);
      return { items: [], errors: [...errors, message] };
    }

    const found = story;
    const tree = await fetchJson<ItemTree>(itemUrl(Number(found.objectID)), {
      headers: JSON_HEADERS,
    });
    const top = (tree.children ?? []).filter((c): c is ItemTree => Boolean(c?.id && c?.text));
    const items = top.map((c) => ({
      storyId: Number(found.objectID),
      commentId: c.id,
      text: c.text ?? '',
      createdAt: c.created_at ?? found.created_at,
    }));
    return { items, errors };
  } catch (err) {
    const message = (err as Error).message;
    console.error('[hn-hiring] fetch failed:', message);
    return { items: [], errors: [message] };
  }
}
