import path from 'node:path';
import { fileURLToPath } from 'node:url';

// All API plugins resolve filesystem locations relative to the repo root.
// This file lives at `ui/plugins/_paths.ts`, so `../..` from import.meta.url
// reaches the repo root. Earlier code lived in `ui/vite.config.ts` where the
// same path needed only `..` — bumping a level deeper without updating the
// URL was a real regression that broke `/api/cv` (looked up cv.pdf at
// `ui/config/cv.pdf` instead of `config/cv.pdf`). Don't let this re-bit-rot.
export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const APPLIED_PATH = path.join(REPO_ROOT, 'config', 'applied.json');
export const JOBS_PATH = path.join(REPO_ROOT, 'data', 'jobs.json');
export const REVIEWS_PATH = path.join(REPO_ROOT, 'data', 'ai-reviews.json');
export const PREFERENCES_PATH = path.join(REPO_ROOT, 'config', 'preferences.json');
export const PROFILE_PATH = path.join(REPO_ROOT, 'config', 'profile.json');
export const APPLICATIONS_DIR = path.join(REPO_ROOT, 'data', 'applications');
export const APPLY_QUEUE_PATH = path.join(REPO_ROOT, 'data', 'apply-queue.json');
export const APPLY_WORKER_PID_PATH = path.join(REPO_ROOT, 'data', 'apply-worker.pid');
export const CV_BASENAME = path.join(REPO_ROOT, 'config', 'cv');
export const DATA_DIR = path.join(REPO_ROOT, 'data');
export const JOBS_BODIES_PATH = path.join(REPO_ROOT, 'data', 'jobs-bodies.json');
export const SWIPE_SKIPS_PATH = path.join(REPO_ROOT, 'data', 'swipe-skips.json');
export const BRIEF_PATH = path.join(REPO_ROOT, 'config', 'candidate-brief.md');
