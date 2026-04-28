import type { Job } from './types.js';

const FEED_TITLE = 'job-hunt — new matches';
const FEED_DESC = 'Daily senior frontend / web3 / AI engineering jobs new since the last run.';
const FEED_LINK = 'https://github.com/FranRom/job-hunt/blob/main/JOBS.md';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function pubDate(iso: string): string {
  return new Date(iso).toUTCString();
}

function itemDescription(job: Job): string {
  const parts: string[] = [];
  if (job.company) parts.push(`<strong>${escapeXml(job.company)}</strong>`);
  if (job.location) parts.push(escapeXml(job.location));
  if (job.salary) parts.push(`💰 ${escapeXml(job.salary)}`);
  parts.push(`Score: ${job.fitScore} · Source: ${job.source} · Category: ${job.category}`);
  return parts.join(' · ');
}

export function renderFeed(newJobs: Job[], generatedAt: string): string {
  const sorted = [...newJobs].sort((a, b) => b.fitScore - a.fitScore).slice(0, 50);
  const buildDate = pubDate(generatedAt);
  const items = sorted
    .map((job) => {
      const title = escapeXml(
        `[${job.fitScore}] ${job.title}${job.company ? ` — ${job.company}` : ''}`,
      );
      const link = escapeXml(job.url);
      const desc = itemDescription(job);
      const date = pubDate(job.postedAt ?? generatedAt);
      return `    <item>
      <title>${title}</title>
      <link>${link}</link>
      <guid isPermaLink="false">${escapeXml(job.id)}</guid>
      <pubDate>${date}</pubDate>
      <category>${escapeXml(job.category)}</category>
      <description>${desc}</description>
    </item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(FEED_TITLE)}</title>
    <link>${escapeXml(FEED_LINK)}</link>
    <description>${escapeXml(FEED_DESC)}</description>
    <language>en-us</language>
    <lastBuildDate>${buildDate}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}
