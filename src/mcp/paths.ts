// MCP-side mirror of `ui/plugins/_paths.ts`. The MCP server is repo-coupled
// (CLAUDE.md "Repo-coupled by design") — it reads `data/` and `config/` from
// the working tree. Keeping a separate copy here avoids cross-importing from
// `ui/` into `src/`, which would drag Vite/Connect types into the MCP build.
//
// This file lives at `src/mcp/paths.ts`, so `../..` reaches the repo root.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const DATA_DIR = path.join(REPO_ROOT, 'data');
export const JOBS_PATH = path.join(REPO_ROOT, 'data', 'jobs.json');
export const JOBS_BODIES_PATH = path.join(REPO_ROOT, 'data', 'jobs-bodies.json');
export const REVIEWS_PATH = path.join(REPO_ROOT, 'data', 'ai-reviews.json');
export const APPLIED_PATH = path.join(REPO_ROOT, 'config', 'applied.json');
export const PREFERENCES_PATH = path.join(REPO_ROOT, 'config', 'preferences.json');
export const PROFILE_PATH = path.join(REPO_ROOT, 'config', 'profile.json');
export const BRIEF_PATH = path.join(REPO_ROOT, 'config', 'candidate-brief.md');
export const APPLY_QUEUE_PATH = path.join(REPO_ROOT, 'data', 'apply-queue.json');
export const APPLY_WORKER_PID_PATH = path.join(REPO_ROOT, 'data', 'apply-worker.pid');
export const SWIPE_SKIPS_PATH = path.join(REPO_ROOT, 'data', 'swipe-skips.json');
export const APPLICATIONS_DIR = path.join(REPO_ROOT, 'data', 'applications');
