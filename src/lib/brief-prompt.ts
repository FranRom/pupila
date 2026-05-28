// Single source of truth for the candidate-brief summarization prompt.
//
// Both entry points that turn a CV-like document into config/candidate-brief.md
// share this builder so they can't drift:
//   - the `pnpm run setup-brief` CLI (src/setup-brief.ts)
//   - the UI's POST /api/cv middleware (ui/plugins/brief.ts)
//
// The output contract is identical regardless of source — three short
// paragraphs of plain markdown — so a LinkedIn-sourced brief is comparable in
// quality to a CV-sourced one. Only the *framing* changes: a LinkedIn "Save to
// PDF" export has a predictable structure (and predictable boilerplate) that
// the LLM does better with when we name it explicitly.

export type BriefSource = 'cv' | 'linkedin';

// Shared three-paragraph contract + closing instructions. Kept verbatim across
// sources so the resulting brief has the same shape no matter where the raw
// text came from.
const OUTPUT_CONTRACT = `Output ONLY three short paragraphs as plain markdown text. No preamble, no markdown fences, no headings, no commentary.

PARAGRAPH 1 — Who they are: role, years of experience, primary location, primary stack/skills. Be concrete (frameworks, languages, tools they ship with regularly).
PARAGRAPH 2 — What they're looking for: target seniority (senior / lead / staff / principal IC), domains/sectors of interest (web3, AI, fintech, etc.), location preference (remote-worldwide / remote-EMEA / hybrid in <city> / open to relocation).
PARAGRAPH 3 — What to avoid: roles that look like a fit on paper but aren't. Examples: wrong specialty (backend if frontend, etc.), wrong level (junior, intern, exec), on-site only, US-only positions, support/solutions/devrel/GTM titles.

Aim for 6-10 lines total. Drop anything that doesn't help a job-matching tool decide. Don't editorialize.`;

const CV_INTRO = `You are summarizing the following CV into a short candidate brief that will be sent to an LLM each time the candidate's job-matching tool evaluates a posting. The brief decides whether the LLM agrees with the rule-based fit score.`;

const LINKEDIN_INTRO = `You are summarizing the candidate's LinkedIn profile into a short candidate brief that will be sent to an LLM each time the candidate's job-matching tool evaluates a posting. The brief decides whether the LLM agrees with the rule-based fit score.`;

// LinkedIn "Save to PDF" exports interleave profile content with structural
// boilerplate (Contact section, "Page N of M" footers, endorsement/skill
// counts, "Top Skills", repeated headers). Naming the source lets the LLM
// ignore that noise and read the Experience/Education sections as a résumé.
const LINKEDIN_PREAMBLE = `The text below was extracted from a LinkedIn profile exported via "Save to PDF". Treat it as the candidate's résumé. Ignore LinkedIn boilerplate — contact details, "Page N of M" footers, skill-endorsement counts, "Top Skills" / "Contact" section labels, and repeated page headers. Infer the candidate's current role, seniority, and stack from the Experience and Education sections.`;

/**
 * Build the summarization prompt for a CV or LinkedIn profile export.
 *
 * @param text     parsed plain text of the document (CV or LinkedIn PDF)
 * @param source   'cv' (default) or 'linkedin' — only changes the framing
 * @param maxChars hard cap on how much of `text` we forward to the LLM
 */
export function buildBriefPrompt(text: string, source: BriefSource, maxChars: number): string {
  const label = source === 'linkedin' ? 'LINKEDIN PROFILE' : 'CV';
  const intro = source === 'linkedin' ? `${LINKEDIN_INTRO}\n\n${LINKEDIN_PREAMBLE}` : CV_INTRO;
  return `${intro}

${OUTPUT_CONTRACT}

${label}:
${text.slice(0, maxChars)}`;
}
