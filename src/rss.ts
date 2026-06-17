import { XMLParser } from 'fast-xml-parser';
import type { RawRssItem } from './types.js';
import { fetchText, RSS_HEADERS } from './utils.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  trimValues: true,
  cdataPropName: '#cdata',
  processEntities: false,
  htmlEntities: false,
});

interface RssRoot {
  rss?: { channel?: { item?: RawRssItem | RawRssItem[] } };
  feed?: { entry?: RawRssItem | RawRssItem[] };
}

// Parse an arbitrary XML document with the same hardened parser config used for
// RSS (CDATA preserved, entities left raw). Used by non-RSS XML feeds such as
// Personio's `<workzag-jobs>` careers export.
export function parseXml(xml: string): unknown {
  return parser.parse(xml);
}

export async function fetchRssItems(url: string): Promise<RawRssItem[]> {
  const xml = await fetchText(url, { headers: RSS_HEADERS });
  const parsed = parser.parse(xml) as RssRoot;
  const items = parsed.rss?.channel?.item ?? parsed.feed?.entry;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

export function rssGuid(item: RawRssItem): string | null {
  if (!item.guid) return null;
  if (typeof item.guid === 'string') return item.guid;
  return item.guid['#text'] ?? null;
}

export function rssLink(item: RawRssItem): string | null {
  if (item.link && typeof item.link === 'string') return item.link;
  return rssGuid(item);
}
