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
import { probeSlug } from '../../src/lib/source-probe.js';
import { SLUGS_LOCAL_PATH } from './_paths.ts';
import { readBody } from './_shared.ts';

// GET  /api/sources         → { ats: AtsView[] } — shipped + overlay + effective
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
};

const BASE: Record<AtsKey, readonly string[]> = {
  ashby: slugs.ashby,
  greenhouse: slugs.greenhouse,
  lever: slugs.lever,
  ashbyPrivate: slugs.ashbyPrivate,
};

// Ashby-private isn't probeable (see source-probe.ts) — UI hides its verify CTA.
const VERIFY_SUPPORTED: Record<AtsKey, boolean> = {
  ashby: true,
  greenhouse: true,
  lever: true,
  ashbyPrivate: false,
};

interface AtsView {
  key: AtsKey;
  label: string;
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
      verifySupported: VERIFY_SUPPORTED[key],
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
      // Register the more specific path FIRST — connect matches by prefix, so
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
