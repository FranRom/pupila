// Local-only AI per-job review. Shells out to `claude -p` so it runs against
// the user's Claude Code subscription (Max plan), not the API. Designed to be
// invoked manually after `pnpm run dev`, never from CI.
//
// Reads:
//   data/jobs.json          — pipeline output (no body, no _signals as input here)
//   data/jobs-bodies.json   — sidecar with full bodies (gitignored, regenerated daily)
//   data/ai-reviews.json    — existing reviews (created if missing)
//   config/candidate-brief.md — natural-language candidate description
//
// Writes:
//   data/ai-reviews.json    — { [jobId]: AiReview }
//
// CLI:
//   pnpm run ai-review                  # top 20 unreviewed by fitScore
//   pnpm run ai-review --top=50         # top 50 unreviewed
//   pnpm run ai-review --force          # also re-review existing entries
//   pnpm run ai-review --ids=abc,def    # specific job ids only

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { parseReviewJson } from './ai-review-parse.js';
import { loadProfile } from './filters.js';
import { runLlm } from './lib/llm.js';
import type { AiReview, AiReviews, Job } from './types.js';

const JOBS_PATH = 'data/jobs.json';
const BODIES_PATH = 'data/jobs-bodies.json';
const REVIEWS_PATH = 'data/ai-reviews.json';
const BRIEF_PATH = 'config/candidate-brief.md';
const PROFILE_PATH = 'config/profile.json';
const BODY_MAX_CHARS = 3500;

interface CliArgs {
  top: number;
  force: boolean;
  ids: string[] | null;
}

function parseArgs(argv: string[]): CliArgs {
  let top = 20;
  let force = false;
  let ids: string[] | null = null;
  for (const arg of argv) {
    if (arg.startsWith('--top=')) {
      const n = Number.parseInt(arg.slice(6), 10);
      if (!Number.isNaN(n) && n > 0) top = n;
    } else if (arg === '--force') {
      force = true;
    } else if (arg.startsWith('--ids=')) {
      ids = arg
        .slice(6)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return { top, force, ids };
}

async function readJsonOrDefault<T>(path: string, fallback: T): Promise<T> {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function buildPrompt(brief: string, job: Job, body: string, matchedRoles: string[]): string {
  const rolesLine =
    matchedRoles.length > 0 ? matchedRoles.join(', ') : 'none of the candidate’s target roles';
  return `You are reviewing a job posting for the following candidate.
Be skeptical and concise. Don't be sycophantic. Spot mismatches.

CANDIDATE
${brief.trim()}

JOB
Title: ${job.title}
Company: ${job.company ?? 'unknown'}
Location: ${job.location ?? 'not specified'}
Salary: ${job.salary ?? 'not disclosed'}
Source: ${job.source}
Rule-based fit score: ${job.fitScore}/100 (category: ${job.category})
Matched target role(s): ${rolesLine}

POSTING BODY
${body.slice(0, BODY_MAX_CHARS)}

TASK
Return STRICT JSON in this exact shape. No preamble, no markdown fences, no commentary.

{
  "summary": "one-sentence factual summary of what the role actually is",
  "wants": ["3 short bullets on the most important things they want"],
  "offers": ["up to 3 bullets on comp, mission, or notable perks; skip generic 'work-life balance' fluff"],
  "redFlags": ["0-3 bullets on real concerns: vagueness, role mismatch, location constraints, hidden requirements; empty array if none"],
  "verdict": "strong-match | match | weak-match | skip",
  "reason": "one short sentence on why the verdict, especially if it disagrees with the rule-based score of ${job.fitScore}"
}

VERDICT GUIDANCE
- strong-match: exactly what the candidate wants; senior+ IC role, stack matches deeply, remote-friendly
- match: solid alignment, worth applying
- weak-match: technically passes filters but the actual role is misaligned
- skip: real mismatch hidden under matching keywords (wrong specialty, wrong level, on-site only, etc.)

Note: "Matched target role(s)" above is what the rule engine matched against the candidate's stated target titles. If it says none matched, weigh whether this role is genuinely one the candidate wants before rating it highly.`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!existsSync(BRIEF_PATH)) {
    console.error(`✗ Missing ${BRIEF_PATH}. Edit that file to describe yourself first.`);
    process.exit(1);
  }

  const brief = await readFile(BRIEF_PATH, 'utf8');

  // Resolve role ids on each job to their human labels for the prompt.
  // Best-effort — a missing/unreadable profile just yields raw ids.
  const roleLabels = new Map<string, string>();
  try {
    const profile = await loadProfile(PROFILE_PATH);
    for (const role of profile.roles ?? []) roleLabels.set(role.id, role.label);
  } catch {
    // Leave the map empty; matched ids fall through as-is.
  }

  const jobs = await readJsonOrDefault<Job[]>(JOBS_PATH, []);
  const bodies = await readJsonOrDefault<Record<string, string>>(BODIES_PATH, {});
  const reviews = await readJsonOrDefault<AiReviews>(REVIEWS_PATH, {});

  if (jobs.length === 0) {
    console.error(`✗ ${JOBS_PATH} is empty. Run \`pnpm run dev\` first.`);
    process.exit(1);
  }
  if (Object.keys(bodies).length === 0) {
    console.error(
      `✗ ${BODIES_PATH} missing or empty. It's regenerated by \`pnpm run dev\` (gitignored).`,
    );
    process.exit(1);
  }

  // Drop reviews for jobs that are no longer in jobs.json so the file stays small.
  const liveIds = new Set(jobs.map((j) => j.id));
  for (const id of Object.keys(reviews)) {
    if (!liveIds.has(id)) delete reviews[id];
  }

  let candidates: Job[];
  if (args.ids) {
    const set = new Set(args.ids);
    candidates = jobs.filter((j) => set.has(j.id));
  } else {
    const filtered = args.force ? jobs.slice() : jobs.filter((j) => !reviews[j.id]);
    filtered.sort((a, b) => b.fitScore - a.fitScore);
    candidates = filtered.slice(0, args.top);
  }

  if (candidates.length === 0) {
    console.log('Nothing to review. (Pass --force to re-review existing entries.)');
    return;
  }

  console.log(`Reviewing ${candidates.length} job(s) via local LLM CLI...`);
  let reviewed = 0;
  let skipped = 0;

  for (const [i, job] of candidates.entries()) {
    const body = bodies[job.id];
    const tag = `[${i + 1}/${candidates.length}] ${job.fitScore} ${job.title} @ ${job.company ?? '?'}`;
    if (!body) {
      console.log(`  ${tag} — skipped (no body; re-run pnpm run dev)`);
      skipped++;
      continue;
    }

    process.stdout.write(`  ${tag}... `);

    try {
      const matchedRoles = (job.roleMatches ?? []).map((id) => roleLabels.get(id) ?? id);
      const raw = await runLlm(buildPrompt(brief, job, body, matchedRoles));
      const parsed = parseReviewJson(raw);
      const review: AiReview = {
        jobId: job.id,
        reviewedAt: new Date().toISOString(),
        model: process.env.PUPILA_LLM ?? 'claude',
        ...parsed,
      };
      reviews[job.id] = review;
      // Save after every successful review — partial runs survive Ctrl-C / rate limits.
      await writeFile(REVIEWS_PATH, `${JSON.stringify(reviews, null, 2)}\n`);
      console.log(parsed.verdict);
      reviewed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`error: ${msg.slice(0, 120)}`);
      skipped++;
    }
  }

  console.log(
    `\nDone. ${reviewed} reviewed, ${skipped} skipped. ${Object.keys(reviews).length} total in ${REVIEWS_PATH}.`,
  );
}

main().catch((err: unknown) => {
  console.error('Fatal:', err);
  process.exit(1);
});
