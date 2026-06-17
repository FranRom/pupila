import { writeFile } from 'node:fs/promises';
import type { Plugin } from 'vite';
import slugs from '../../config/slugs.json' with { type: 'json' };
import {
  ATS_KEYS,
  type AtsKey,
  loadSlugOverlay,
  resolveSlugs,
  type SlugOverlay,
  sanitizeDelta,
} from '../../src/lib/slugs.js';
import { isProbeSupported, probeSlug } from '../../src/lib/source-probe.js';
import { SLUGS_LOCAL_PATH } from './_paths.ts';
import { readBody } from './_shared.ts';

// GET  /api/sources         → { ats: AtsView[] } - shipped + overlay + effective
// PUT  /api/sources         → persist one ATS's delta to slugs.local.json
// POST /api/sources/verify  → live probe a slug ({ supported, found })
//
// slugs.json is read-only here (committed baseline). Only slugs.local.json is
// written, so upstream tier-S updates keep flowing through.

const LABELS: Record<AtsKey, string> = {
  ashby: 'Ashby',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashbyPrivate: 'Ashby (private)',
  recruitee: 'Recruitee',
};

// One-line explainer per ATS, shown as a tooltip on the group's ⓘ marker.
const NOTES: Record<AtsKey, string> = {
  ashby: 'Public Ashby boards (jobs.ashbyhq.com/<slug>).',
  greenhouse: 'Public Greenhouse boards (boards.greenhouse.io/<slug>).',
  lever: 'Public Lever boards (jobs.lever.co/<slug>).',
  ashbyPrivate:
    'Ashby companies whose public posting API is turned off, so pupila fetches them via the ' +
    "job board's GraphQL instead (e.g. chainlink-labs). They're invisible to the normal Ashby " +
    'source. Verify and board-health use the same GraphQL, so they work here too.',
  recruitee:
    'Public Recruitee careers boards (<slug>.recruitee.com). The slug is the careers subdomain, ' +
    'which often differs from a custom careers domain - check <slug>.recruitee.com/api/offers loads.',
};

const BASE: Record<AtsKey, readonly string[]> = {
  ashby: slugs.ashby,
  greenhouse: slugs.greenhouse,
  lever: slugs.lever,
  ashbyPrivate: slugs.ashbyPrivate,
  recruitee: slugs.recruitee,
};

interface AtsView {
  key: AtsKey;
  label: string;
  note: string;
  verifySupported: boolean;
  shipped: string[];
  add: string[];
  remove: string[];
  effective: string[];
}

function buildView(overlay: SlugOverlay): AtsView[] {
  return ATS_KEYS.map((key) => {
    const delta = overlay[key] ?? { add: [], remove: [] };
    return {
      key,
      label: LABELS[key],
      note: NOTES[key],
      verifySupported: isProbeSupported(key),
      shipped: [...BASE[key]],
      add: delta.add,
      remove: delta.remove,
      effective: resolveSlugs(BASE[key], delta),
    };
  });
}

function isAtsKey(value: unknown): value is AtsKey {
  return typeof value === 'string' && (ATS_KEYS as readonly string[]).includes(value);
}

export function sourcesApiPlugin(): Plugin {
  return {
    name: 'pupila-sources-api',
    configureServer(server) {
      // Register the more specific path FIRST - connect matches by prefix, so
      // /api/sources would otherwise also swallow /api/sources/verify.
      server.middlewares.use('/api/sources/verify', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        try {
          const body = (await readBody(req)) as { key?: unknown; slug?: unknown };
          const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';
          if (!isAtsKey(body.key) || !slug) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'key and slug are required' }));
            return;
          }
          res.end(JSON.stringify(await probeSlug(body.key, slug)));
        } catch (err) {
          console.error('[sources verify api]', err);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });

      // POST /api/sources/health → live board-health for every effective slug
      // across the probeable ATS. On-demand (no aggregator run needed); the UI
      // fires it behind a "Check board health" button and flags only the broken
      // boards. Heavy (~one request per company) but parallel and user-initiated.
      server.middlewares.use('/api/sources/health', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        try {
          const overlay = await loadSlugOverlay(SLUGS_LOCAL_PATH);
          const tasks: Array<Promise<{ key: AtsKey; slug: string; state: string; found: number }>> =
            [];
          for (const key of ATS_KEYS) {
            if (!isProbeSupported(key)) continue;
            for (const slug of resolveSlugs(BASE[key], overlay[key])) {
              tasks.push(
                probeSlug(key, slug).then((r) => ({ key, slug, state: r.state, found: r.found })),
              );
            }
          }
          const results = await Promise.all(tasks);
          res.end(JSON.stringify({ results }));
        } catch (err) {
          console.error('[sources health api]', err);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });

      server.middlewares.use('/api/sources', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        try {
          if (req.method === 'GET') {
            const overlay = await loadSlugOverlay(SLUGS_LOCAL_PATH);
            res.end(JSON.stringify({ ats: buildView(overlay) }));
            return;
          }
          if (req.method === 'PUT') {
            const body = (await readBody(req)) as {
              key?: unknown;
              add?: unknown;
              remove?: unknown;
            };
            if (!isAtsKey(body.key)) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'invalid ats key' }));
              return;
            }
            const delta = sanitizeDelta({ add: body.add, remove: body.remove });
            const overlay = await loadSlugOverlay(SLUGS_LOCAL_PATH);
            if (delta.add.length || delta.remove.length) overlay[body.key] = delta;
            else delete overlay[body.key];
            await writeFile(SLUGS_LOCAL_PATH, `${JSON.stringify(overlay, null, 2)}\n`, 'utf8');
            res.end(JSON.stringify({ ats: buildView(overlay) }));
            return;
          }
          res.statusCode = 405;
          res.end();
        } catch (err) {
          console.error('[sources api]', err);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });
    },
  };
}
