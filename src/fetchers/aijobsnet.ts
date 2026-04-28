import type { RawAiJobs } from '../types.js';
import { fetchText, RSS_HEADERS, stripHtml } from '../utils.js';

const BASE = 'https://aijobs.net';
const PAGES = ['/', '/?page=2', '/?page=3', '/?reg=5', '/?reg=5&page=2', '/?reg=5&page=3'] as const;

const LI_RE =
  /<li class="d-flex justify-content-between position-relative[^"]*"[^>]*>([\s\S]*?)<\/li>/g;
const LINK_RE = /<a[^>]*href="(\/job\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/;
const SALARY_RE =
  /<span class="text-bg-(?:success|secondary|warning) px-1 rounded">([^<]+)<\/span>/;
const SENIORITY_RE = /<span class="text-bg-warning px-1 rounded">([^<]+)<\/span>/;
const POSTED_RE = /<div class="text-muted">\s*([^<]+?)\s*<\/div>/;
const TAG_SECTION_RE = /<div>\s*((?:<span>[^<]+<\/span>\s*\|?\s*)+)\s*<\/div>/;
const TAG_TOKEN_RE = /<span>([^<]+)<\/span>/g;
const TRAILING_ID_RE = /-(\d+)\/?$/;
const BASE_ID_RE = /-id(\d+)-/i;

function parsePage(html: string): RawAiJobs[] {
  const rows: RawAiJobs[] = [];
  for (const match of html.matchAll(LI_RE)) {
    const inner = match[1];
    if (!inner) continue;

    const linkMatch = inner.match(LINK_RE);
    if (!linkMatch?.[1] || !linkMatch[2]) continue;
    const path = linkMatch[1];
    const title = stripHtml(linkMatch[2])
      .replace(/\s+/g, ' ')
      .replace(/(?:^|\s)(?:Featured|Feat\.)(?=\s|$)/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!title) continue;

    const baseId = path.match(BASE_ID_RE)?.[1];
    const trailingId = path.match(TRAILING_ID_RE)?.[1];
    const id = baseId ?? trailingId ?? path;

    const salary = inner.match(SALARY_RE)?.[1]?.trim() ?? null;
    const seniority = inner.match(SENIORITY_RE)?.[1]?.trim() ?? null;
    const postedRelative = inner.match(POSTED_RE)?.[1]?.trim() ?? null;

    const tags: string[] = [];
    const tagSection = inner.match(TAG_SECTION_RE)?.[1];
    if (tagSection) {
      for (const t of tagSection.matchAll(TAG_TOKEN_RE)) {
        const txt = (t[1] ?? '').trim();
        if (txt) tags.push(txt);
      }
    }

    const afterSeniority = inner.split(/<span class="text-bg-warning [^"]*">[^<]+<\/span>/)[1];
    let companyAndLocation: string | null = null;
    if (afterSeniority) {
      const txt = stripHtml(afterSeniority).replace(/\s+/g, ' ').trim();
      const beforeAgo = txt.split(/\d+\s*[a-z]+\s+ago/i)[0]?.trim();
      companyAndLocation = beforeAgo || null;
    }

    rows.push({
      id,
      url: `${BASE}${path}`,
      title,
      salary,
      tags,
      seniority,
      companyAndLocation,
      postedRelative,
    });
  }
  return rows;
}

async function fetchPage(path: string): Promise<RawAiJobs[]> {
  try {
    const html = await fetchText(`${BASE}${path}`, { headers: RSS_HEADERS });
    return parsePage(html);
  } catch (err) {
    console.error(`[aijobsnet:${path}]`, (err as Error).message);
    return [];
  }
}

export async function fetchAiJobsNet(): Promise<RawAiJobs[]> {
  const results = await Promise.all(PAGES.map((p) => fetchPage(p)));
  const flat = results.flat();
  const seen = new Set<string>();
  const deduped: RawAiJobs[] = [];
  for (const j of flat) {
    if (seen.has(j.id)) continue;
    seen.add(j.id);
    deduped.push(j);
  }
  return deduped;
}
