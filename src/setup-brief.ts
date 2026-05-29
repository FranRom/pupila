// First-run setup: ingest a CV, run it through whichever local LLM CLI is
// installed, and write a concise candidate brief to config/candidate-brief.md.
//
// The brief is what `pnpm run ai-review` sends to the LLM for each job, so
// keeping it sharp directly improves the per-job verdicts.
//
// CLI:
//   pnpm run setup-brief --file path/to/cv.pdf           # parse PDF (via pdfjs-dist)
//   pnpm run setup-brief --file path/to/cv.docx          # parse DOCX (via mammoth)
//   pnpm run setup-brief --file path/to/cv.md            # plain markdown
//   pnpm run setup-brief --file path/to/cv.txt           # plain text
//   pnpm run setup-brief --linkedin path/to/profile.pdf  # LinkedIn "Save to PDF" export
//   cat cv.txt | pnpm run setup-brief                    # stdin
//
// `--linkedin` is the same pipeline as `--file` but tells the LLM the input is
// a LinkedIn profile export so it ignores LinkedIn's boilerplate. A `--file`
// whose name contains "linkedin" is auto-treated as a LinkedIn source.
//
// Provider: auto-detects claude / codex / gemini / opencode on PATH (in that
// order). Override with PUPILA_LLM=<provider>.

import { existsSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { type BriefSource, buildBriefPrompt } from './lib/brief-prompt.js';
import { writeBriefBody } from './lib/brief-template.js';
import { detectFormat, parseCvFile } from './lib/cv-parser.js';
import { detectLlmCli, runLlm } from './lib/llm.js';

// How many chars of the parsed CV we send to the LLM. Configurable via
// PUPILA_CV_MAX_CHARS for users hitting OOM kills on large CVs.
const MAX_CV_CHARS = Number(process.env.PUPILA_CV_MAX_CHARS ?? '12000');
const CV_DEST_BASENAME = 'config/cv';

interface CliArgs {
  file: string | null;
  source: BriefSource;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let file: string | null = null;
  // Only flips to 'linkedin' when --linkedin is passed, or when a --file path
  // looks like a LinkedIn export (see inference below).
  let source: BriefSource = 'cv';
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
    } else if (arg.startsWith('--linkedin=')) {
      file = arg.slice(11);
      source = 'linkedin';
    } else if (arg === '--linkedin' && i + 1 < argv.length) {
      const next = argv[i + 1];
      if (next) {
        file = next;
        source = 'linkedin';
        i++;
      }
    } else if (arg === '--help' || arg === '-h') {
      help = true;
    }
  }
  // Auto-detect a LinkedIn export passed via --file by its filename, so
  // `--file ~/Downloads/LinkedIn_Profile.pdf` still gets the tuned prompt.
  // Match only the basename — a directory like ~/linkedin-stuff/ shouldn't
  // silently flip a regular CV to the LinkedIn prompt. The "Reading … (…,
  // LinkedIn export)" log in main() surfaces the decision either way.
  if (source === 'cv' && file && /linkedin/i.test(basename(file))) {
    source = 'linkedin';
  }
  return { file, source, help };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
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
    console.log('  pnpm run setup-brief --linkedin path/to/profile.pdf   # LinkedIn "Save to PDF"');
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
    const sourceLabel = args.source === 'linkedin' ? 'LinkedIn export' : 'CV';
    console.log(`Reading ${args.file} (${format}, ${sourceLabel})...`);
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

  const prompt = buildBriefPrompt(cvText, args.source, MAX_CV_CHARS);
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
