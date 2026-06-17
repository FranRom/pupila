import { parseAtsUrl } from './fetchers/bluedoor.js';
import { personioJobUrl } from './lib/ats-endpoints.js';
import { rssLink } from './rss.js';
import { parseSalary } from './salary.js';
import type {
  Job,
  RawAavePost,
  RawAiJobs,
  RawAshbyJobWithSlug,
  RawAshbyPrivateJobWithSlug,
  RawBluedoorJob,
  RawGreenhouseJobWithSlug,
  RawHimalayas,
  RawHnHiringPost,
  RawHnHit,
  RawJobicy,
  RawLeverJobWithSlug,
  RawPersonioJobDescription,
  RawPersonioPositionWithSlug,
  RawRecruiteeOfferWithSlug,
  RawRemoteOk,
  RawRemoteYeah,
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

function withSalary(salary: string | null): {
  salary: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
} {
  if (!salary) return { salary: null, salaryMin: null, salaryMax: null, salaryCurrency: null };
  const parsed = parseSalary(salary);
  return { salary, salaryMin: parsed.min, salaryMax: parsed.max, salaryCurrency: parsed.currency };
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
      ...withSalary(null),
      postedAt,
      fetchedAt,
      fitScore: 0,
      categories: [],
    };
  });
}

export function normalizeRemotive(items: RawRemotive[], fetchedAt: string): Job[] {
  return items.map((j) => {
    const url = j.url;
    const location = j.candidate_required_location?.trim() || null;
    const salary = j.salary?.trim() || null;
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
      ...withSalary(salary),
      postedAt: safeIso(j.publication_date),
      fetchedAt,
      fitScore: 0,
      categories: [],
    };
  });
}

export function normalizeJobicy(items: RawJobicy[], fetchedAt: string): Job[] {
  return items.flatMap((j) => {
    const url = j.url?.trim();
    const title = j.jobTitle?.trim();
    if (!url || !title) return [];
    // jobGeo carries region terms / country lists (e.g. "Europe,  Netherlands")
    // — keep it as the location string so the persona-neutral geo filter can
    // match accepted regions. asPlain decodes the HTML entities Jobicy leaves in
    // its industry/type labels (e.g. "Legal &amp; Compliance").
    const location = j.jobGeo?.trim() || null;
    return [
      {
        id: makeId('jobicy', url, `${j.companyName ?? ''}-${title}-${j.id}`),
        source: 'jobicy',
        title,
        company: j.companyName?.trim() || null,
        url,
        location,
        remote: true,
        body: asPlain(j.jobDescription),
        tags: joinTags((j.jobIndustry ?? []).map(asPlain), (j.jobType ?? []).map(asPlain), [
          j.jobLevel,
        ]),
        ...structuredSalary(j.salaryMin, j.salaryMax, j.salaryCurrency, j.salaryPeriod),
        postedAt: safeIso(j.pubDate),
        fetchedAt,
        fitScore: 0,
        categories: [],
      } satisfies Job,
    ];
  });
}

export function normalizeHimalayas(items: RawHimalayas[], fetchedAt: string): Job[] {
  return items.flatMap((j) => {
    const url = j.applicationLink?.trim();
    const title = j.title?.trim();
    if (!url || !title) return [];
    // locationRestrictions is a country array; an empty array means the role is
    // open worldwide. Keep it as the location string so the persona-neutral geo
    // filter can match accepted regions (or treat "Worldwide" as in-region).
    const restrictions = (j.locationRestrictions ?? []).map((s) => s.trim()).filter(Boolean);
    const location = restrictions.length ? restrictions.join(', ') : 'Worldwide';
    return [
      {
        id: makeId('himalayas', url, `${j.companySlug ?? j.companyName ?? ''}-${title}`),
        source: 'himalayas',
        title,
        company: j.companyName?.trim() || null,
        url,
        location,
        remote: true,
        body: asPlain(j.description),
        tags: joinTags(j.categories, j.seniority, [j.employmentType]),
        ...structuredSalary(j.minSalary, j.maxSalary, j.currency, j.salaryPeriod),
        postedAt: safeIso(j.pubDate),
        fetchedAt,
        fitScore: 0,
        categories: [],
      } satisfies Job,
    ];
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
        ...withSalary(null),
        postedAt: safeIso(item.pubDate),
        fetchedAt,
        fitScore: 0,
        categories: [],
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

function cdataText(d: RawRemoteYeah['description']): string {
  if (!d) return '';
  return typeof d === 'string' ? d : (d['#cdata'] ?? '');
}

// RemoteYeah's RSS carries no <salary> field — when a posting states pay, it's in
// the description prose (~15% of jobs). Surface it by pulling the one clause that
// has BOTH a currency figure AND a compensation context word, then handing it to
// parseSalary. The dual gate avoids matching funding rounds / pricing / perks.
const SALARY_MONEY_RE = /[$€£]\s?\d/;
const SALARY_CONTEXT_RE =
  /\b(salary|salaries|compensation|base pay|base salary|pay range|pay rate|hourly|per year|per hour|annually|annual|OTE|total comp|comp range|range of|earn)\b/i;
// 401(k)/403(b) read as money to the parser ('401k' → 401,000) — strip first.
const RETIREMENT_PLAN_RE = /\b(401\s*\(?k\)?|403\s*\(?b\)?)\b/gi;

function extractSalaryFromBody(body: string): string | null {
  // Split into clause-ish chunks (lines, then sentence breaks) so a stray dollar
  // figure elsewhere in the body can't bleed into the salary clause.
  for (const chunk of body.split(/\n|(?<=[.;])\s+/)) {
    const cleaned = chunk.replace(RETIREMENT_PLAN_RE, ' ');
    if (SALARY_MONEY_RE.test(cleaned) && SALARY_CONTEXT_RE.test(cleaned)) {
      return cleaned.trim().replace(/\s+/g, ' ').slice(0, 160);
    }
  }
  return null;
}

export function normalizeRemoteYeah(items: RawRemoteYeah[], fetchedAt: string): Job[] {
  return items.flatMap((item) => {
    // The feed XML-escapes `&` as `&amp;` in the link; decode it first so the
    // tracking params split correctly and normalizeUrl can drop them (otherwise
    // a stray `amp;ref` param survives). normalizeUrl then strips utm_source/ref.
    const rawLink = (typeof item.link === 'string' ? item.link : '').replace(/&amp;/g, '&');
    const url = normalizeUrl(rawLink) || rawLink;
    if (!url) return [];
    const title = asPlain(item.title);
    if (!title) return [];

    const company = item.company?.trim() || null;
    const location = item.location?.trim() || null;
    const category = item.category?.trim() || null;
    const body = asPlain(cdataText(item.description));
    // <tags> is a single comma-separated string (skills + seniority + employment).
    const tagList = (item.tags ?? '').split(',');

    return [
      {
        id: makeId('remoteyeah', url, `${company ?? ''}-${title}`),
        source: 'remoteyeah',
        title,
        company,
        url,
        location,
        remote: true,
        body,
        tags: joinTags(tagList, [category]),
        ...withSalary(extractSalaryFromBody(body)),
        postedAt: safeIso(item.pubDate),
        fetchedAt,
        fitScore: 0,
        categories: [],
      } satisfies Job,
    ];
  });
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
      ...withSalary(j.salary),
      postedAt: j.postedAt,
      fetchedAt,
      fitScore: 0,
      categories: [],
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
      ...withSalary(j.salary),
      postedAt: parseRelativeAgo(j.postedRelative),
      fetchedAt,
      fitScore: 0,
      categories: [],
    };
  });
}

// Plausible company name: short-ish, no sentence punctuation, starts alphanumeric.
// Reject the "post has no header → first segment is the entire body" case which
// otherwise leaks an entire job description into the company column.
function isPlausibleCompany(s: string): boolean {
  if (!s || s.length > 60) return false;
  if (/[.!?]/.test(s)) return false;
  if (!/^[A-Za-z0-9]/.test(s)) return false;
  return true;
}

const HN_ROLE_PATTERN =
  /\b(?:senior|sr\.?|staff|principal|lead|head)?\s*(?:full[- ]?stack|frontend|front[- ]end|backend|back[- ]end|software|web|mobile)?\s*(?:engineer|developer|architect)s?\b[^.!?\n]{0,60}/i;

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
    const hasHeader = headerParts.length >= 2;
    const company =
      hasHeader && headerParts[0] && isPlausibleCompany(headerParts[0]) ? headerParts[0] : null;

    let title: string;
    if (hasHeader) {
      const titleCandidate =
        headerParts.find((part) =>
          /\b(engineer|developer|architect|lead|director|head)\b/i.test(part),
        ) ??
        headerParts[1] ??
        firstLine;
      title = titleCandidate.slice(0, 140);
    } else {
      // No header → look for a role-keyword phrase anywhere in the body before
      // falling back to a truncated first line.
      const match = text.match(HN_ROLE_PATTERN);
      title = match ? match[0].trim().slice(0, 140) : firstLine.slice(0, 100);
    }
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
        ...withSalary(null),
        postedAt: safeIso(p.createdAt),
        fetchedAt,
        fitScore: 0,
        categories: [],
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
        ...withSalary(null),
        postedAt: safeIso(h.created_at),
        fetchedAt,
        fitScore: 0,
        categories: [],
      } satisfies Job,
    ];
  });
}

export function normalizeAshby(items: RawAshbyJobWithSlug[], fetchedAt: string): Job[] {
  return items.map((j) => {
    const company = j.__slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const secondaryLocations =
      j.secondaryLocations?.map((s) => s.location).filter((x): x is string => Boolean(x)) ?? [];
    const allLocations = [j.location, ...secondaryLocations].filter((x): x is string => Boolean(x));
    const location = allLocations[0] ?? null;
    const remote = Boolean(j.isRemote) || j.workplaceType === 'Remote';
    const tags = joinTags([j.department, j.team, j.employmentType, j.workplaceType, j.__slug]);
    const salary =
      j.compensation?.compensationTierSummary?.trim() ||
      j.compensation?.scrapeableCompensationSalarySummary?.trim() ||
      null;
    return {
      id: makeId('ashby', j.jobUrl, `${company}-${j.title}-${j.id}`),
      source: 'ashby',
      title: j.title.trim(),
      company,
      url: j.jobUrl,
      location,
      remote,
      body: asPlain(j.descriptionPlain),
      tags,
      ...withSalary(salary),
      postedAt: safeIso(j.publishedAt),
      fetchedAt,
      fitScore: 0,
      categories: [],
    };
  });
}

export function normalizeLever(items: RawLeverJobWithSlug[], fetchedAt: string): Job[] {
  return items.map((j) => {
    const company = j.__slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const cat = j.categories ?? {};
    const location = cat.location ?? null;
    const allLocs = cat.allLocations ?? (location ? [location] : []);
    const remote =
      j.workplaceType === 'remote' ||
      allLocs.some((l) => /remote|worldwide|anywhere/i.test(l ?? ''));
    const body = asPlain(
      j.descriptionPlain ||
        j.description ||
        [j.additionalPlain, j.additional, ...(j.lists?.map((l) => l.content) ?? [])]
          .filter(Boolean)
          .join('\n\n'),
    );
    const tags = joinTags(j.tags, [cat.team, cat.department, cat.commitment, j.__slug]);
    const salary = formatLeverSalary(j.salaryRange) || j.salaryDescriptionPlain?.trim() || null;
    return {
      id: makeId('lever', j.hostedUrl, `${company}-${j.text}-${j.id}`),
      source: 'lever',
      title: j.text.trim(),
      company,
      url: j.hostedUrl,
      location,
      remote,
      body,
      tags,
      ...withSalary(salary),
      postedAt: safeIso(j.createdAt),
      fetchedAt,
      fitScore: 0,
      categories: [],
    };
  });
}

function formatLeverSalary(
  range: { min?: number; max?: number; currency?: string; interval?: string } | undefined,
): string | null {
  if (!range) return null;
  const min = range.min ?? 0;
  const max = range.max ?? 0;
  if (min <= 0 && max <= 0) return null;
  const fmt = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}K` : `${n}`);
  const ccy = range.currency ?? '';
  return `${fmt(min)}-${fmt(max)} ${ccy}`.trim();
}

function slugToCompany(slug: string): string {
  return slug.replace(/[-.]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Recruitee ships numeric salary as strings ("45000"); coerce to a positive
// number (or null) so structuredSalary can annualize it.
function toPositiveNumber(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function normalizeRecruitee(items: RawRecruiteeOfferWithSlug[], fetchedAt: string): Job[] {
  return items.flatMap((j) => {
    const url = (j.careers_url || j.careers_apply_url || '').trim();
    const title = j.title?.trim();
    if (!url || !title) return [];
    const location =
      j.location?.trim() ||
      [j.city, j.country]
        .map((s) => s?.trim())
        .filter(Boolean)
        .join(', ') ||
      null;
    // remote/hybrid/on_site are explicit booleans; treat only fully-remote as
    // remote. The work-type label rides along in tags so the persona-neutral
    // filter can still see hybrid/on-site.
    const workType = j.remote ? 'remote' : j.hybrid ? 'hybrid' : j.on_site ? 'on-site' : null;
    const sal = j.salary ?? undefined;
    return [
      {
        id: makeId('recruitee', url, `${j.__slug}-${title}-${j.id ?? j.slug ?? ''}`),
        source: 'recruitee',
        title,
        company: j.company_name?.trim() || slugToCompany(j.__slug),
        url,
        location,
        remote: j.remote === true,
        body: asPlain([j.description, j.requirements].filter(Boolean).join('\n\n')),
        tags: joinTags(j.tags, [j.department, j.employment_type_code, workType]),
        ...structuredSalary(
          toPositiveNumber(sal?.min),
          toPositiveNumber(sal?.max),
          sal?.currency,
          sal?.period,
        ),
        postedAt: safeIso(j.published_at) ?? safeIso(j.created_at),
        fetchedAt,
        fitScore: 0,
        categories: [],
      } satisfies Job,
    ];
  });
}

// Pull the text out of one Personio jobDescription <value> node — a CDATA value
// parses to { '#cdata': html }, a plain one to a string or { '#text': ... }.
function personioValueText(value: RawPersonioJobDescription['value']): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value['#cdata'] ?? value['#text'] ?? '';
}

export function normalizePersonio(items: RawPersonioPositionWithSlug[], fetchedAt: string): Job[] {
  return items.flatMap((j) => {
    const id = j.id != null ? String(j.id) : '';
    const title = asPlain(j.name); // decodes &amp; etc. (entities aren't pre-decoded)
    if (!id || !title) return [];
    const url = personioJobUrl(j.__slug, id);
    const location = asPlain(j.office) || null;
    // Concatenate every description section (name + CDATA html) for the body.
    const jd = j.jobDescriptions?.jobDescription;
    const sections = jd ? (Array.isArray(jd) ? jd : [jd]) : [];
    const body = asPlain(
      sections
        .map((s) => [s?.name, personioValueText(s?.value)].filter(Boolean).join('\n'))
        .join('\n\n'),
    );
    return [
      {
        id: makeId('personio', url, `${j.__slug}-${title}-${id}`),
        source: 'personio',
        title,
        company: slugToCompany(j.__slug),
        url,
        location,
        remote: inferRemote(location, title, body),
        body,
        tags: joinTags([
          asPlain(j.department) || null,
          asPlain(j.recruitingCategory) || null,
          j.seniority,
          j.employmentType,
          j.occupationCategory,
        ]),
        ...withSalary(null),
        postedAt: safeIso(j.createdAt),
        fetchedAt,
        fitScore: 0,
        categories: [],
      } satisfies Job,
    ];
  });
}

export function normalizeAshbyPrivate(
  items: RawAshbyPrivateJobWithSlug[],
  fetchedAt: string,
): Job[] {
  return items.map((j) => {
    const url = `https://jobs.ashbyhq.com/${j.__slug}/${j.id}`;
    const detail = j.detail;
    const workplaceType = detail?.workplaceType ?? j.workplaceType ?? null;
    const remote = workplaceType?.toLowerCase() === 'remote';
    const location = detail?.locationName?.trim() || j.locationName?.trim() || null;
    const secondary = detail?.secondaryLocationNames ?? [];
    const allLocs = [location, ...secondary].filter((x): x is string => Boolean(x));
    const body = asPlain(detail?.descriptionHtml ?? '');
    const tags = joinTags(
      detail?.teamNames,
      [detail?.departmentName, detail?.employmentType ?? j.employmentType, workplaceType, j.__slug],
      allLocs,
    );
    const salary = detail?.compensationTierSummary?.trim() || null;
    return {
      id: makeId('ashby-private', url, j.id),
      source: 'ashby-private',
      title: (detail?.title ?? j.title).trim(),
      company: slugToCompany(j.__slug),
      url,
      location,
      remote,
      body,
      tags,
      ...withSalary(salary),
      postedAt: safeIso(detail?.publishedDate),
      fetchedAt,
      fitScore: 0,
      categories: [],
    };
  });
}

export function normalizeAave(items: RawAavePost[], fetchedAt: string): Job[] {
  return items.map((p) => {
    const url = `https://aave.com/careers/${p.slug}`;
    const remote = p.workplaceType === 'remote';
    const body = asPlain(
      [p.summary, p.description].filter((x): x is string => Boolean(x)).join('\n\n'),
    );
    const tags = joinTags([p.team, p.department, p.commitment, p.workplaceType, 'aave']);
    return {
      id: makeId('aave', url, p.id),
      source: 'aave',
      title: p.title.trim(),
      company: 'Aave',
      url,
      location: p.location?.trim() || null,
      remote,
      body,
      tags,
      ...withSalary(null),
      postedAt: null,
      fetchedAt,
      fitScore: 0,
      categories: [],
    };
  });
}

// Annualization factors so per-hour/day/week/month comp sorts against per-year
// comp instead of sinking below it. Conservative working-period assumptions.
const SALARY_PERIOD_FACTOR: Record<string, number> = {
  year: 1,
  annual: 1,
  yearly: 1,
  month: 12,
  monthly: 12,
  week: 52,
  weekly: 52,
  day: 260,
  daily: 260,
  hour: 2080,
  hourly: 2080,
};

// Build the salary quartet from structured min/max/currency/period fields,
// annualizing via SALARY_PERIOD_FACTOR. Shared by every source that ships
// structured compensation (bluedoor, jobicy).
function structuredSalary(
  min: number | null | undefined,
  max: number | null | undefined,
  currency: string | null | undefined,
  period: string | null | undefined,
): {
  salary: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
} {
  const hasMin = typeof min === 'number' && Number.isFinite(min);
  const hasMax = typeof max === 'number' && Number.isFinite(max);
  if (!hasMin && !hasMax) {
    return { salary: null, salaryMin: null, salaryMax: null, salaryCurrency: null };
  }
  const factor = SALARY_PERIOD_FACTOR[(period ?? 'year').toLowerCase()] ?? 1;
  const annMin = hasMin ? Math.round(min * factor) : null;
  const annMax = hasMax ? Math.round(max * factor) : null;
  const ccy = currency?.trim() || null;
  const fmt = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}K` : `${n}`);
  const parts = [annMin, annMax].filter((n): n is number => n !== null).map(fmt);
  const salary = parts.length ? `${parts.join('-')}${ccy ? ` ${ccy}` : ''}`.trim() : null;
  return { salary, salaryMin: annMin, salaryMax: annMax, salaryCurrency: ccy };
}

// bluedoor ships no company name — recover it from the ATS slug in the URL, else
// fall back to the stable org_id so different employers never collapse together
// in the company+title dedup pass.
function bluedoorCompany(j: RawBluedoorJob): string | null {
  const ref = parseAtsUrl(j.apply_url ?? j.source_url);
  if (ref) return slugToCompany(ref.slug);
  return j.org_id?.trim() || null;
}

export function normalizeBluedoor(items: RawBluedoorJob[], fetchedAt: string): Job[] {
  return items.flatMap((j) => {
    const url = (j.apply_url || j.source_url || '').trim();
    const title = j.title?.trim();
    if (!url || !title) return [];
    const locationText = j.location_text?.trim() || null;
    // location_text is the region signal (often messy/multi-region) — keep it in
    // the body so the persona-neutral geo filter can match accepted regions; the
    // display `location` prefers the concise structured fields.
    const displayLocation =
      [j.city, j.region, j.country]
        .map((s) => s?.trim())
        .filter(Boolean)
        .join(', ') || locationText;
    const remote =
      j.workplace_type?.toLowerCase() === 'remote' ||
      j.remote_policy?.toLowerCase() === 'remote' ||
      inferRemote(locationText);
    const body = asPlain(
      [j.description_text, locationText].filter((x): x is string => Boolean(x)).join('\n\n'),
    );
    const tags = joinTags([
      j.provider,
      j.department,
      j.team,
      j.employment_type,
      j.workplace_type,
      j.country,
    ]);
    return [
      {
        id: makeId('bluedoor', url, j.job_id),
        source: 'bluedoor',
        title,
        company: bluedoorCompany(j),
        url,
        location: displayLocation,
        remote,
        body,
        tags,
        ...structuredSalary(j.salary_min, j.salary_max, j.salary_currency, j.salary_period),
        postedAt: safeIso(j.source_posted_at) ?? safeIso(j.first_seen_at),
        fetchedAt,
        fitScore: 0,
        categories: [],
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
      ...withSalary(null),
      postedAt: safeIso(j.updated_at),
      fetchedAt,
      fitScore: 0,
      categories: [],
    };
  });
}
