// Canonical board-URL builders for the public ATS APIs. The slug is
// encodeURIComponent'd at this single boundary so neither the fetchers nor the
// verify probe can be slug-injected. Valid slugs (see SLUG_PATTERN in slugs.ts)
// pass through unchanged because encodeURIComponent leaves [a-z0-9._-] alone.

export const ashbyBoardUrl = (slug: string): string =>
  `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`;

export const greenhouseBoardUrl = (slug: string): string =>
  `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`;

export const leverBoardUrl = (slug: string): string =>
  `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`;

// Recruitee's public Careers Site API. The slug is the careers subdomain; valid
// slugs (SLUG_PATTERN) contain only [a-z0-9._-] so encodeURIComponent is a
// no-op, but it still guards the host boundary against an injected slug.
export const recruiteeBoardUrl = (slug: string): string =>
  `https://${encodeURIComponent(slug)}.recruitee.com/api/offers/`;
