import slugs from '../../config/slugs.json' with { type: 'json' };
import { personioBoardUrl } from '../lib/ats-endpoints.js';
import { loadSlugOverlay, resolveSlugs } from '../lib/slugs.js';
import { parseXml } from '../rss.js';
import type { FetcherResult, RawPersonioPosition, RawPersonioPositionWithSlug } from '../types.js';
import { fetchText, RSS_HEADERS } from '../utils.js';
import { fetchMultiSlug } from './_shared.js';

// Personio's feed root: <workzag-jobs><position>...</position>...</workzag-jobs>.
interface PersonioRoot {
  'workzag-jobs'?: { position?: RawPersonioPosition | RawPersonioPosition[] } | null;
}

export async function fetchPersonio(): Promise<FetcherResult<RawPersonioPositionWithSlug>> {
  const slugList = resolveSlugs(slugs.personio, (await loadSlugOverlay()).personio);
  return fetchMultiSlug('personio', slugList, async (slug) => {
    const xml = await fetchText(personioBoardUrl(slug), { headers: RSS_HEADERS });
    const root = parseXml(xml) as PersonioRoot;
    const positions = root['workzag-jobs']?.position;
    const list = positions ? (Array.isArray(positions) ? positions : [positions]) : [];
    return list.map((p) => ({ ...p, __slug: slug }));
  });
}
