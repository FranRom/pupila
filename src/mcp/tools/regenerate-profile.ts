import { writeFile } from 'node:fs/promises';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readBriefBody as defaultReadBriefBody } from '../../lib/brief-template.js';
import type { LlmProvider } from '../../lib/llm.js';
import {
  generateProfileFromBrief as defaultGenerateProfileFromBrief,
  mergeProfile,
  type PersonalizationDelta,
  type ProfileShape,
} from '../../lib/profile-generator.js';
import { readJsonOrNull } from '../../utils.js';
import { safeHandler, type ToolResult, toolError, toolJson } from '../errors.js';
import { BRIEF_PATH, PROFILE_PATH } from '../paths.js';
import {
  type RegenerateProfileInput,
  regenerateProfileInputSchema,
} from '../schemas/regenerate-profile.js';

// Dependency surface — `generateDelta` is the only LLM-invoking dependency;
// tests inject a stub so we never spawn a real LLM CLI in CI. `readBrief`
// is also injectable so a fixture can supply a brief without touching disk.
export interface RegenerateProfileDeps {
  briefPath: string;
  profilePath: string;
  readBrief: (path: string) => Promise<string | null>;
  generateDelta: (
    brief: string,
    provider: LlmProvider | undefined,
  ) => Promise<PersonalizationDelta>;
}

const DEFAULT_DEPS: RegenerateProfileDeps = {
  briefPath: BRIEF_PATH,
  profilePath: PROFILE_PATH,
  readBrief: defaultReadBriefBody,
  generateDelta: defaultGenerateProfileFromBrief,
};

// Module-level single-flight lock. Like the UI's `inFlight` closure
// variable, but at module scope so the MCP server's long-lived process
// shares the lock across tool calls.
let inFlight = false;

export async function runRegenerateProfile(
  input: RegenerateProfileInput,
  deps: RegenerateProfileDeps = DEFAULT_DEPS,
): Promise<ToolResult> {
  if (inFlight) {
    return toolError('regenerate_profile is already running. Wait for it to finish first.');
  }
  inFlight = true;
  try {
    const brief = await deps.readBrief(deps.briefPath);
    if (!brief?.trim()) {
      return toolError(
        'config/candidate-brief.md is missing or empty — finish onboarding first (drop a CV in the UI Profile tab or run `pnpm run setup-brief`).',
      );
    }

    const base = await readJsonOrNull<ProfileShape>(deps.profilePath);
    if (!base || typeof base !== 'object') {
      return toolError(
        'config/profile.json is missing or unparseable. Restart `pnpm run dev` once to re-bootstrap.',
      );
    }

    // Provider 'auto' → undefined, which lets runLlm auto-detect.
    const provider: LlmProvider | undefined =
      input.provider && input.provider !== 'auto' ? input.provider : undefined;

    const delta = await deps.generateDelta(brief, provider);
    const { profile, weightsChanged, keywordsChanged, rolesChanged, categoriesChanged } =
      mergeProfile(base, delta);
    await writeFile(deps.profilePath, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');

    return toolJson({
      ok: true,
      provider: input.provider ?? 'auto',
      weightsChanged,
      keywordsChanged,
      rolesChanged,
      categoriesChanged,
    });
  } finally {
    inFlight = false;
  }
}

export function registerRegenerateProfile(server: McpServer): void {
  server.registerTool(
    'regenerate_profile',
    {
      title: 'Regenerate scoring profile from candidate brief',
      description:
        "Re-run the LLM personalization pass on config/candidate-brief.md and merge the resulting delta into config/profile.json. Universal sections (junior excludes, seniorReq, US-only filter) are preserved — only personal weights/keywords change. Blocks until done (LLM call takes 10s–2min). Single-flight: a second concurrent call returns an error envelope. `provider` defaults to 'auto' (detects which LLM CLI is installed).",
      inputSchema: regenerateProfileInputSchema,
    },
    safeHandler<RegenerateProfileInput>('regenerate_profile', (input) =>
      runRegenerateProfile(input),
    ),
  );
}

/** Test-only — clear the single-flight lock between cases. */
export function __resetRegenerateProfileLockForTests(): void {
  inFlight = false;
}
