// Shared helpers for reading/writing config/candidate-brief.md while
// preserving the instructional preamble. Used by both setup-brief.ts (CLI)
// and the UI's /api/brief middleware.

import { readFile, writeFile } from 'node:fs/promises';

export const BRIEF_PATH = 'config/candidate-brief.md';
export const BRIEF_START = '<!-- candidate-brief:start -->';
export const BRIEF_END = '<!-- candidate-brief:end -->';

const FALLBACK_PREAMBLE = `# Candidate brief

This file is the candidate description that \`pnpm run ai-review\` sends to the
LLM when it judges each posting. Keep it short and specific — 6–10 lines is
plenty.

The fastest way to fill this in is **\`pnpm run setup-brief --file path/to/cv.pdf\`**
or open the local UI (\`pnpm run ui\`) and use the Profile tab.

`;

/**
 * Write a new candidate brief body, preserving the file's instructional
 * preamble and footer markers. If the existing file lacks the markers
 * (or doesn't exist), wraps the body in the canonical template.
 */
export async function writeBriefBody(newBody: string): Promise<void> {
  let existing = '';
  try {
    existing = await readFile(BRIEF_PATH, 'utf-8');
  } catch {
    // First-time setup — fall through to fresh template.
  }

  const startIdx = existing.indexOf(BRIEF_START);
  const endIdx = existing.indexOf(BRIEF_END);

  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    const preamble = existing.trim() ? existing.split('\n\n').slice(0, 1).join('\n\n') : '';
    const head = preamble ? `${preamble}\n\n` : FALLBACK_PREAMBLE;
    await writeFile(
      BRIEF_PATH,
      `${head}${BRIEF_START}\n\n${newBody.trim()}\n\n${BRIEF_END}\n`,
      'utf-8',
    );
    return;
  }

  const head = existing.slice(0, startIdx + BRIEF_START.length);
  const tail = existing.slice(endIdx);
  await writeFile(BRIEF_PATH, `${head}\n\n${newBody.trim()}\n\n${tail}`, 'utf-8');
}

/**
 * Read the current candidate brief, stripping the preamble and markers
 * to return just the user-editable body. Returns null if the file doesn't
 * exist yet, or '' if it exists but the body block is empty.
 */
export async function readBriefBody(): Promise<string | null> {
  let existing: string;
  try {
    existing = await readFile(BRIEF_PATH, 'utf-8');
  } catch {
    return null;
  }
  const startIdx = existing.indexOf(BRIEF_START);
  const endIdx = existing.indexOf(BRIEF_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return existing.trim();
  }
  return existing.slice(startIdx + BRIEF_START.length, endIdx).trim();
}
