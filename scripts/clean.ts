// Wipe locally-generated artifacts so the repo looks like a fresh clone.
// Personal-by-default: keeps `config/candidate-brief.md` and
// `config/applied.json`. Pass `--all` to nuke those too (e.g. when starting
// over with a different CV). Pass `--onboarding` to wipe ONLY the
// onboarding state (preferences + brief + raw CV) so you can re-test the
// first-run wizard without losing jobs.json or applied.json.
//
// Run via: pnpm run clean [--all]
//          pnpm run clean:onboarding

import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));

const FILES_GENERATED: readonly string[] = [
  'data/jobs.json',
  'data/ai-reviews.json',
  'data/feed.xml',
  'data/jobs-bodies.json',
  // Operational queue state — regenerated as soon as the worker runs.
  'data/apply-queue.json',
  'data/apply-worker.pid',
  'JOBS.md',
];

const DIRS_KEEP_GITKEEP: readonly string[] = ['data/archive', 'data/raw'];

const LOG_PATTERNS: readonly RegExp[] = [/^launchd-.*\.log$/, /^cron-.*\.log$/];

const FILES_PERSONAL: readonly string[] = [
  'config/candidate-brief.md',
  'config/applied.json',
  // The personalized scoring profile (weights, keyword lists, categories,
  // roles, location). Gitignored + bootstrapped from config/profile.default.json
  // on first run, so a genuine fresh clone has no profile.json — wiping it on
  // --all makes the reset truly clone-equivalent and re-bootstraps the current
  // default schema on the next run.
  'config/profile.json',
  // User-curated state from the Jinder swipe deck.
  'data/swipe-skips.json',
];

// Directories whose entire contents (sans .gitkeep) are wiped by `--all`.
// These hold user-curated artifacts that took LLM time to produce, so the
// default clean preserves them.
const DIRS_PERSONAL_KEEP_GITKEEP: readonly string[] = ['data/applications'];

// Files wiped by `--onboarding` so the first-run wizard re-triggers.
// Includes the preferences stamp (clearing onboardedAt), the LLM-generated
// brief, and the raw CV uploads in any supported format.
const FILES_ONBOARDING: readonly string[] = [
  'config/preferences.json',
  'config/candidate-brief.md',
  'config/cv.pdf',
  'config/cv.docx',
  'config/cv.md',
  'config/cv.txt',
];

interface CliArgs {
  all: boolean;
  onboarding: boolean;
  help: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let all = false;
  let onboarding = false;
  let help = false;
  for (const arg of argv) {
    if (arg === '--all') all = true;
    else if (arg === '--onboarding') onboarding = true;
    else if (arg === '-h' || arg === '--help') help = true;
  }
  return { all, onboarding, help };
}

function tryRemove(absPath: string, displayPath: string, removed: string[]): void {
  if (!existsSync(absPath)) return;
  rmSync(absPath, { force: true });
  removed.push(displayPath);
}

function cleanGitkeepDir(dir: string, removed: string[]): void {
  const abs = path.join(REPO, dir);
  if (!existsSync(abs)) return;
  for (const entry of readdirSync(abs)) {
    if (entry === '.gitkeep') continue;
    const full = path.join(abs, entry);
    rmSync(full, { recursive: true, force: true });
    removed.push(`${dir}/${entry}`);
  }
}

function cleanLogsInDataDir(removed: string[]): void {
  const abs = path.join(REPO, 'data');
  if (!existsSync(abs)) return;
  for (const entry of readdirSync(abs)) {
    if (!LOG_PATTERNS.some((re) => re.test(entry))) continue;
    const full = path.join(abs, entry);
    if (!statSync(full).isFile()) continue;
    rmSync(full, { force: true });
    removed.push(`data/${entry}`);
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: pnpm run clean [--all | --onboarding]');
    console.log('');
    console.log('Default: wipes generated artifacts only. Keeps:');
    for (const f of FILES_PERSONAL) console.log(`  ${f}`);
    console.log('');
    console.log('--all          fresh-clone reset: removes the personal files above (brief, applied list,');
    console.log('               scoring profile, swipe-skips), the contents of data/applications/, AND onboarding');
    console.log('               state (preferences.json + raw CV). The first-run wizard will re-trigger');
    console.log('               on next `pnpm run ui` load.');
    console.log('--onboarding   wipes ONLY onboarding state (preferences + brief + raw CV) so the');
    console.log('               first-run wizard re-triggers. Keeps jobs.json and applied.json.');
    return;
  }

  const removed: string[] = [];

  // --onboarding is a focused mode: wipe only the wizard inputs/outputs,
  // leave everything else alone so jobs/applied state survives.
  if (args.onboarding) {
    for (const f of FILES_ONBOARDING) {
      tryRemove(path.join(REPO, f), f, removed);
    }
  } else {
    for (const f of FILES_GENERATED) {
      tryRemove(path.join(REPO, f), f, removed);
    }
    for (const dir of DIRS_KEEP_GITKEEP) {
      cleanGitkeepDir(dir, removed);
    }
    cleanLogsInDataDir(removed);

    if (args.all) {
      for (const f of FILES_PERSONAL) {
        tryRemove(path.join(REPO, f), f, removed);
      }
      for (const dir of DIRS_PERSONAL_KEEP_GITKEEP) {
        cleanGitkeepDir(dir, removed);
      }
      // --all = true "fresh clone" reset. Also drop the onboarding stamp +
      // raw CV so the first-run wizard re-triggers on next UI load. Brief
      // is already covered by FILES_PERSONAL above; the loop is a no-op
      // for paths that overlap.
      for (const f of FILES_ONBOARDING) {
        tryRemove(path.join(REPO, f), f, removed);
      }
    }
  }

  if (removed.length === 0) {
    console.log('nothing to clean');
    return;
  }

  for (const r of removed) console.log(`  removed ${r}`);
  console.log(`\n✓ Cleaned ${removed.length} item${removed.length === 1 ? '' : 's'}.`);
  if (args.onboarding || args.all) {
    console.log('  (onboarding wizard will re-trigger on next `pnpm run ui` load)');
  } else if (!args.all) {
    const kept = FILES_PERSONAL.filter((f) => existsSync(path.join(REPO, f)));
    if (kept.length > 0) {
      console.log(`  (kept: ${kept.join(', ')} — pass --all to remove these too)`);
    }
  }
}

main();
