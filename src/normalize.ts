import { rssLink } from './rss.js';
import type {
  Job,
  RawAiJobs,
  RawGreenhouseJobWithSlug,
  RawHnHiringPost,
  RawHnHit,
  RawRemoteOk,
  RawRemotive,
  RawRssItem,
  RawWeb3Career,
} from './types.js';
import { normalizeUrl, safeIso, sha1Hex, stripHtml } from './utils.js';

const REMOTE_RE = /\b(remote|worldwide|anywhere|distributed|global)\b/i;
const HN_HEAD_SEP_RE = /\s*[|·•—–-]\s*/;
const APPLY_LINK_RE = /https?:\/\/[^\s<>"]+/g;
const RELATIVE_AGO_RE = /^(\d+)\s*(min|mins|m|h|hr|hrs|d|w|wk|wks|mo|mos|y|yr|yrs)\s*ago$/i;

function makeId(source: string, url: string, fallback: string): string {
  const norm = normalizeUrl(url || fallback);
  return sha1Hex(norm || `${source}:${fallback}`);
}

function inferRemote(...candidates: (string | null | undefined)[]): boolean {
  return candidates.some((c) => (c ? REMOTE_RE.test(c) : false));
}

function asPlain(s: string | null | undefined): string {
  return stripHtml(s ?? '');
}

function joinTags(...sources: (Array<string | null | undefined> | undefined | null)[]): string[] {
  const set = new Set<string>();
  for (const arr of sources) {
    if (!arr) continue;
    for (const t of arr) {
      if (t === null || t === undefined) continue;
      const v = String(t).trim();
      if (v) set.add(v);
    }
  }
  return Array.from(set);
}

function parseRelativeAgo(s: string | null | undefined, now = new Date()): string | null {
  if (!s) return null;
  const m = s.trim().match(RELATIVE_AGO_RE);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] ?? '').toLowerCase();
  let ms = 0;
  if (unit.startsWith('min') || unit === 'm') ms = n * 60_000;
  else if (unit.startsWith('h')) ms = n * 60 * 60_000;
  else if (unit === 'd') ms = n * 24 * 60 * 60_000;
  else if (unit.startsWith('w')) ms = n * 7 * 24 * 60 * 60_000;
  else if (unit.startsWith('mo')) ms = n * 30 * 24 * 60 * 60_000;
  else if (unit.startsWith('y')) ms = n * 365 * 24 * 60 * 60_000;
  else return null;
  return new Date(now.getTime() - ms).toISOString();
}

export function normalizeRemoteOk(items: RawRemoteOk[], fetchedAt: string): Job[] {
  return items.map((j) => {
    const slug = j.slug ? `https://remoteok.com/remote-jobs/${j.slug}` : '';
    const url = j.apply_url || j.url || slug;
    const fallback = `${j.company ?? ''}-${j.position ?? ''}-${j.id ?? ''}`;
    const postedAt = safeIso(j.date) ?? safeIso(j.epoch);
    return {
      id: makeId('remoteok', url, fallback),
      source: 'remoteok',
      title: (j.position ?? '').trim(),
      company: j.company?.trim() || null,
      url: url || slug,
      location: j.location?.trim() || null,
      remote: true,
      body: asPlain(j.description),
      tags: joinTags(j.tags),
      postedAt,
      fetchedAt,
      fitScore: 0,
      category: 'general',
    };
  });
}

export function normalizeRemotive(items: RawRemotive[], fetchedAt: string): Job[] {
  return items.map((j) => {
    const url = j.url;
    const location = j.candidate_required_location?.trim() || null;
    return {
      id: makeId('remotive', url, `${j.company_name}-${j.title}-${j.id}`),
      source: 'remotive',
      title: j.title.trim(),
      company: j.company_name?.trim() || null,
      url,
      location,
      remote: true,
      body: asPlain(j.description),
      tags: joinTags(j.tags, [j.job_type, j.category]),
      postedAt: safeIso(j.publication_date),
      fetchedAt,
      fitScore: 0,
      category: 'general',
    };
  });
}

function normalizeRssGeneric(
  items: RawRssItem[],
  source: 'weworkremotely' | 'cryptojobslist',
  fetchedAt: string,
): Job[] {
  return items.flatMap((item) => {
    const link = rssLink(item);
    if (!link) return [];
    const rawTitle = asPlain(typeof item.title === 'string' ? item.title : '');
    if (!rawTitle) return [];

    let company: string | null = null;
    let title = rawTitle;
    const sepIdx = rawTitle.search(/[:|-]/);
    if (sepIdx > 1 && sepIdx < 60) {
      const left = rawTitle.slice(0, sepIdx).trim();
      const right = rawTitle.slice(sepIdx + 1).trim();
      if (left && right) {
        company = left;
        title = right;
      }
    }

    const body = asPlain(item.description);
    const cats =
      typeof item.category === 'string'
        ? [item.category]
        : Array.isArray(item.category)
          ? item.category
          : [];

    const remote = inferRemote(title, body, ...cats);
    return [
      {
        id: makeId(source, link, `${company ?? ''}-${title}`),
        source,
        title,
        company,
        url: link,
        location: null,
        remote: remote || source === 'weworkremotely',
        body,
        tags: joinTags(cats),
        postedAt: safeIso(item.pubDate),
        fetchedAt,
        fitScore: 0,
        category: 'general',
      } satisfies Job,
    ];
  });
}

export function normalizeWeWorkRemotely(items: RawRssItem[], fetchedAt: string): Job[] {
  return normalizeRssGeneric(items, 'weworkremotely', fetchedAt);
}

export function normalizeCryptoJobsList(items: RawRssItem[], fetchedAt: string): Job[] {
  return normalizeRssGeneric(items, 'cryptojobslist', fetchedAt);
}

export function normalizeWeb3Career(items: RawWeb3Career[], fetchedAt: string): Job[] {
  return items.map((j) => {
    const remote = inferRemote(j.location, j.title, ...j.tags);
    const body = [j.title, j.company, j.location, j.salary, ...j.tags]
      .filter((x): x is string => Boolean(x))
      .join(' \n ');
    return {
      id: makeId('web3career', j.url, `${j.company ?? ''}-${j.title}-${j.jobid}`),
      source: 'web3career',
      title: j.title,
      company: j.company,
      url: j.url,
      location: j.location,
      remote,
      body: asPlain(body),
      tags: joinTags(j.tags, [j.category]),
      postedAt: j.postedAt,
      fetchedAt,
      fitScore: 0,
      category: 'general',
    };
  });
}

export function normalizeAiJobsNet(items: RawAiJobs[], fetchedAt: string): Job[] {
  return items.map((j) => {
    let company: string | null = null;
    let location: string | null = null;
    if (j.companyAndLocation) {
      const cleaned = j.companyAndLocation
        .replace(/^\s*(Full[- ]Time|Part[- ]Time|Contract|Freelance|Internship)\s+/i, '')
        .trim();
      const parts = cleaned.split(/\s+(?=[A-Z])/);
      if (parts.length >= 2) {
        const last = parts[parts.length - 1];
        if (last && /,\s*[A-Za-z]/.test(last)) {
          location = last.trim();
          company = parts.slice(0, -1).join(' ').trim() || null;
        } else {
          company = cleaned;
        }
      } else {
        company = cleaned;
      }
    }
    const remote = inferRemote(location, j.companyAndLocation, j.title, ...j.tags);
    const body = [j.title, j.seniority, j.salary, j.companyAndLocation, ...j.tags]
      .filter((x): x is string => Boolean(x))
      .join(' \n ');
    return {
      id: makeId('aijobsnet', j.url, `${company ?? ''}-${j.title}-${j.id}`),
      source: 'aijobsnet',
      title: j.title,
      company,
      url: j.url,
      location,
      remote,
      body: asPlain(body),
      tags: joinTags(j.tags, [j.seniority]),
      postedAt: parseRelativeAgo(j.postedRelative),
      fetchedAt,
      fitScore: 0,
      category: 'general',
    };
  });
}

export function normalizeHnHiring(items: RawHnHiringPost[], fetchedAt: string): Job[] {
  return items.flatMap((p) => {
    const url = `https://news.ycombinator.com/item?id=${p.commentId}`;
    const text = asPlain(p.text);
    if (!text || text.length < 30) return [];
    const firstLine = (text.split('\n')[0] ?? '').trim();
    const headerParts = firstLine
      .split(HN_HEAD_SEP_RE)
      .map((s) => s.trim())
      .filter(Boolean);
    const company = headerParts[0] ?? null;
    const titleCandidate =
      headerParts.find((p) => /\b(engineer|developer|architect|lead|director|head)\b/i.test(p)) ??
      headerParts[1] ??
      firstLine;
    const title = titleCandidate.slice(0, 140);
    const remote = inferRemote(text);
    const applyUrls = text.match(APPLY_LINK_RE) ?? [];
    return [
      {
        id: makeId('hn-hiring', url, `${company ?? ''}-${title}-${p.commentId}`),
        source: 'hn-hiring',
        title,
        company,
        url,
        location: null,
        remote,
        body: text,
        tags: joinTags(applyUrls.length ? ['has-apply-link'] : []),
        postedAt: safeIso(p.createdAt),
        fetchedAt,
        fitScore: 0,
        category: 'general',
      } satisfies Job,
    ];
  });
}

export function normalizeHnJobs(items: RawHnHit[], fetchedAt: string): Job[] {
  return items.flatMap((h) => {
    const url = h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`;
    const title = (h.title ?? '').trim();
    if (!title) return [];
    const headerParts = title.split(HN_HEAD_SEP_RE).map((s) => s.trim());
    let company: string | null = null;
    const ycMatch = title.match(/^(.+?)\s*\(YC\s+[A-Z]\d+\)/i);
    if (ycMatch?.[1]) company = ycMatch[1].trim();
    else if (headerParts[0]) company = headerParts[0].split(/\sHiring:|:\s/)[0]?.trim() || null;
    const text = asPlain(h.story_text);
    const remote = inferRemote(title, text);
    return [
      {
        id: makeId('hn-jobs', url, `${company ?? ''}-${title}-${h.objectID}`),
        source: 'hn-jobs',
        title: title.slice(0, 200),
        company,
        url,
        location: null,
        remote,
        body: `${title}\n\n${text}`,
        tags: joinTags([]),
        postedAt: safeIso(h.created_at),
        fetchedAt,
        fitScore: 0,
        category: 'general',
      } satisfies Job,
    ];
  });
}

export function normalizeGreenhouse(items: RawGreenhouseJobWithSlug[], fetchedAt: string): Job[] {
  return items.map((j) => {
    const company = j.company_name?.trim() || j.__slug;
    const location = j.location?.name?.trim() || null;
    const remote = inferRemote(location, j.title);
    const tags = joinTags(
      j.departments?.map((d) => d.name) ?? [],
      j.offices?.map((o) => o.name) ?? [],
      [j.__slug],
    );
    return {
      id: makeId('greenhouse', j.absolute_url, `${company}-${j.title}-${j.id}`),
      source: 'greenhouse',
      title: j.title.trim(),
      company,
      url: j.absolute_url,
      location,
      remote,
      body: asPlain(j.content),
      tags,
      postedAt: safeIso(j.updated_at),
      fetchedAt,
      fitScore: 0,
      category: 'general',
    };
  });
}
