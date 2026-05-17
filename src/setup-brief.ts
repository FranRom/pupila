// First-run setup: ingest a CV, run it through whichever local LLM CLI is
// installed, and write a concise candidate brief to config/candidate-brief.md.
//
// The brief is what `pnpm run ai-review` sends to the LLM for each job, so
// keeping it sharp directly improves the per-job verdicts.
//
// CLI:
//   pnpm run setup-brief --file path/to/cv.pdf       # parse PDF (via pdfjs-dist)
//   pnpm run setup-brief --file path/to/cv.docx      # parse DOCX (via mammoth)
//   pnpm run setup-brief --file path/to/cv.md        # plain markdown
//   pnpm run setup-brief --file path/to/cv.txt       # plain text
//   cat cv.txt | pnpm run setup-brief                # stdin
//
// Provider: auto-detects claude / codex / gemini / opencode on PATH (in that
// order). Override with PUPILA_LLM=<provider>.

import { existsSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { writeBriefBody } from './lib/brief-template.js';
import { detectFormat, parseCvFile } from './lib/cv-parser.js';
import { detectLlmCli, runLlm } from './lib/llm.js';

// How many chars of the parsed CV we send to the LLM. Configurable via
// PUPILA_CV_MAX_CHARS for users hitting OOM kills on large CVs.
const MAX_CV_CHARS = Number(process.env.PUPILA_CV_MAX_CHARS ?? '12000');
const CV_DEST_BASENAME = 'config/cv';

interface CliArgs {
  file: string | null;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let file: string | null = null;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg.startsWith('--file=')) {
      file = arg.slice(7);
    } else if (arg === '--file' && i + 1 < argv.length) {
      const next = argv[i + 1];
      if (next) {
        file = next;
        i++;
      }
    } else if (arg === '--help' || arg === '-h') {
      help = true;
    }
  }
  return { file, help };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

function buildPrompt(cvText: string): string {
  return `You are summarizing the following CV into a short candidate brief that will be sent to an LLM each time the candidate's job-matching tool evaluates a posting. The brief decides whether the LLM agrees with the rule-based fit score.

Output ONLY three short paragraphs as plain markdown text. No preamble, no markdown fences, no headings, no commentary.

PARAGRAPH 1 — Who they are: role, years of experience, primary location, primary stack/skills. Be concrete (frameworks, languages, tools they ship with regularly).
PARAGRAPH 2 — What they're looking for: target seniority (senior / lead / staff / principal IC), domains/sectors of interest (web3, AI, fintech, etc.), location preference (remote-worldwide / remote-EMEA / hybrid in <city> / open to relocation).
PARAGRAPH 3 — What to avoid: roles that look like a fit on paper but aren't. Examples: wrong specialty (backend if frontend, etc.), wrong level (junior, intern, exec), on-site only, US-only positions, support/solutions/devrel/GTM titles.

Aim for 6-10 lines total. Drop anything that doesn't help a job-matching tool decide. Don't editorialize.

CV:
${cvText.slice(0, MAX_CV_CHARS)}`;
}

function stripMarkdownFences(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:[a-z]+)?\n?/i, '').replace(/\n?```\s*$/, '');
  }
  return cleaned.trim();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage:');
    console.log('  pnpm run setup-brief --file path/to/cv.pdf');
    console.log('  pnpm run setup-brief --file path/to/cv.docx');
    console.log('  pnpm run setup-brief --file path/to/cv.md');
    console.log('  cat cv.txt | pnpm run setup-brief');
    console.log('');
    console.log('Provider: auto-detects claude/codex/gemini/opencode on PATH.');
    console.log('Override with PUPILA_LLM=<provider>.');
    return;
  }

  let cvText: string;
  if (args.file) {
    if (!existsSync(args.file)) {
      console.error(`✗ File not found: ${args.file}`);
      process.exit(1);
    }
    const format = detectFormat(args.file);
    console.log(`Reading ${args.file} (${format})...`);
    try {
      cvText = await parseCvFile(args.file);
    } catch (err) {
      console.error(`✗ Failed to parse CV: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
    // Persist the raw CV alongside the parsed brief so AI Apply can
    // re-attach it later. Copies in place — most-recent upload wins.
    const dest = `${CV_DEST_BASENAME}.${format}`;
    try {
      await copyFile(args.file, dest);
      console.log(`Saved CV to ${dest}.`);
    } catch (err) {
      console.warn(
        `! Could not copy CV to ${dest}: ${err instanceof Error ? err.message : String(err)} (continuing — AI Apply won't have a CV file to re-attach)`,
      );
    }
  } else {
    if (process.stdin.isTTY) {
      console.error('✗ No input.');
      console.error('  Pass --file <path> (.pdf/.docx/.md/.txt) or pipe CV text via stdin.');
      console.error('  Example: pnpm run setup-brief --file ~/Documents/cv.pdf');
      process.exit(1);
    }
    console.log('Reading CV from stdin...');
    cvText = await readStdin();
  }

  if (!cvText.trim()) {
    console.error('✗ Empty CV — nothing to summarize.');
    process.exit(1);
  }

  let invocation: Awaited<ReturnType<typeof detectLlmCli>>;
  try {
    invocation = await detectLlmCli();
  } catch (err) {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  console.log(
    `Parsed ${cvText.length} chars. Running ${invocation.provider} (${invocation.cmd})...`,
  );

  const prompt = buildPrompt(cvText);
  let raw: string;
  try {
    raw = await runLlm(prompt);
  } catch (err) {
    console.error(`✗ LLM call failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const cleaned = stripMarkdownFences(raw);
  if (!cleaned) {
    console.error('✗ LLM returned empty output.');
    process.exit(1);
  }

  await writeBriefBody(cleaned);
  console.log(`✓ Wrote candidate brief (${cleaned.length} chars).`);
  console.log('  Edit further at: config/candidate-brief.md');
}

main().catch((err: unknown) => {
  console.error('Fatal:', err);
  process.exit(1);
});
