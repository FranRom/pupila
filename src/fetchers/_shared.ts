import type { FetcherResult } from '../types.js';

export async function fetchMultiSlug<T>(
  source: string,
  slugs: readonly string[],
  extract: (slug: string) => Promise<T[]>,
): Promise<FetcherResult<T>> {
  const results = await Promise.all(
    slugs.map(async (slug) => {
      try {
        const items = await extract(slug);
        return { items, errors: [] as string[] };
      } catch (err) {
        const message = (err as Error).message;
        console.error(`[${source}:${slug}]`, message);
        return { items: [] as T[], errors: [`${slug}: ${message}`] };
      }
    }),
  );
  return {
    items: results.flatMap((r) => r.items),
    errors: results.flatMap((r) => r.errors),
  };
}
