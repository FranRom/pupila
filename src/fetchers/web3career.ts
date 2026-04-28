import type { FetcherResult, RawWeb3Career } from '../types.js';
import { fetchText, RSS_HEADERS, safeIso, stripHtml } from '../utils.js';

const BASE = 'https://web3.career';

const CATEGORIES = [
  'senior-jobs',
  'lead-jobs',
  'front-end-jobs',
  'full-stack-jobs',
  'ai-jobs',
] as const;

const ROW_RE =
  /<tr data-jobid=(\d+)[^>]*onclick="tableTurboRowClick\(event, '([^']+)'\)"[^>]*>([\s\S]*?)<\/tr>/g;
const TITLE_RE = /<h2[^>]*>\s*([\s\S]*?)\s*<\/h2>/;
const COMPANY_RE = /<h3[^>]*>\s*([\s\S]*?)\s*<\/h3>/;
const TIME_RE = /<time datetime="([^"]+)"/;
const LOC_RE = /<span style="font-size: 12px; color: #d5d3d3;">\s*([\s\S]*?)\s*<\/span>/;
const SALARY_RE = /<p[^>]*class="[^"]*text-salary[^"]*"[^>]*>([\s\S]*?)<\/p>/;
const TAG_RE = /<a class=text-shadow-1px href="\/[^"]+"[^>]*>\s*([\s\S]*?)\s*<\/a>/g;

function parsePage(html: string, category: string): RawWeb3Career[] {
  const rows: RawWeb3Career[] = [];
  for (const match of html.matchAll(ROW_RE)) {
    const jobid = match[1];
    const path = match[2];
    const inner = match[3];
    if (!jobid || !path || !inner) continue;

    const title = stripHtml(inner.match(TITLE_RE)?.[1] ?? '');
    if (!title) continue;
    const company = stripHtml(inner.match(COMPANY_RE)?.[1] ?? '') || null;
    const postedAt = safeIso(inner.match(TIME_RE)?.[1]);
    const location = stripHtml(inner.match(LOC_RE)?.[1] ?? '') || null;
    const salaryRaw = inner.match(SALARY_RE)?.[1];
    const salary = salaryRaw ? stripHtml(salaryRaw).replace(/\s+/g, ' ').trim() : null;

    const tags: string[] = [];
    for (const t of inner.matchAll(TAG_RE)) {
      const txt = stripHtml(t[1] ?? '').trim();
      if (txt) tags.push(txt);
    }

    rows.push({
      jobid,
      url: `${BASE}${path}`,
      title,
      company,
      postedAt,
      postedRelative: null,
      location,
      salary,
      tags,
      category,
    });
  }
  return rows;
}

async function fetchCategory(slug: string): Promise<FetcherResult<RawWeb3Career>> {
  try {
    const html = await fetchText(`${BASE}/${slug}`, { headers: RSS_HEADERS });
    return { items: parsePage(html, slug), errors: [] };
  } catch (err) {
    const message = (err as Error).message;
    console.error(`[web3career:${slug}]`, message);
    return { items: [], errors: [`${slug}: ${message}`] };
  }
}

export async function fetchWeb3Career(): Promise<FetcherResult<RawWeb3Career>> {
  const results = await Promise.all(CATEGORIES.map((c) => fetchCategory(c)));
  const flat = results.flatMap((r) => r.items);
  const errors = results.flatMap((r) => r.errors);
  const seen = new Set<string>();
  const deduped: RawWeb3Career[] = [];
  for (const j of flat) {
    if (seen.has(j.jobid)) continue;
    seen.add(j.jobid);
    deduped.push(j);
  }
  return { items: deduped, errors };
}
