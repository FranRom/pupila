import type { RawHnComment, RawHnHiringPost, RawHnHit } from '../types.js';
import { fetchJson, JSON_HEADERS } from '../utils.js';

const SEARCH_URL =
  'https://hn.algolia.com/api/v1/search_by_date?query=Ask+HN+Who+is+hiring&tags=story&hitsPerPage=5';

const itemUrl = (id: number) => `https://hn.algolia.com/api/v1/items/${id}`;

interface SearchResponse {
  hits: RawHnHit[];
}

interface ItemTree extends RawHnComment {
  children?: ItemTree[];
}

function pickLatestHiringStory(hits: RawHnHit[]): RawHnHit | null {
  const candidates = hits.filter((h) => /who\s+is\s+hiring/i.test(h.title ?? ''));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return candidates[0] ?? null;
}

export async function fetchHnHiring(): Promise<RawHnHiringPost[]> {
  try {
    const search = await fetchJson<SearchResponse>(SEARCH_URL, { headers: JSON_HEADERS });
    const story = pickLatestHiringStory(search.hits ?? []);
    if (!story) {
      console.error('[hn-hiring] no matching "Who is hiring" story found');
      return [];
    }
    const tree = await fetchJson<ItemTree>(itemUrl(Number(story.objectID)), {
      headers: JSON_HEADERS,
    });
    const top = (tree.children ?? []).filter((c): c is ItemTree => Boolean(c?.id && c?.text));
    return top.map((c) => ({
      storyId: Number(story.objectID),
      commentId: c.id,
      text: c.text ?? '',
      createdAt: c.created_at ?? story.created_at,
    }));
  } catch (err) {
    console.error('[hn-hiring] fetch failed:', (err as Error).message);
    return [];
  }
}
