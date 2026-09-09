// Shared reader for config/preferences.json LLM fields. Used by CLI entrypoints
// (ai-review, setup-brief, apply-worker), Vite plugins, and MCP tools so every
// consumer resolves the same { provider, model } pair.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { type LlmProvider, SUPPORTED_PROVIDERS } from './llm.js';

const DEFAULT_PREFERENCES_PATH = fileURLToPath(
  new URL('../../config/preferences.json', import.meta.url),
);

export interface LlmPreference {
  /** Explicit provider, or undefined for auto-detect. */
  provider: LlmProvider | undefined;
  /** Ollama model when provider is ollama; otherwise null. */
  model: string | null;
}

function isSupportedProvider(value: string): value is LlmProvider {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Read the user's saved LLM choice from preferences.json.
 *
 * - `provider: 'auto'` / missing / invalid → `{ provider: undefined, model: null }`
 * - `model` is set only when `provider === 'ollama'` and `ollamaModel` is non-empty
 * - Missing or unparseable file → auto-detect shape (no throw)
 */
export async function readLlmPreference(
  preferencesPath: string = DEFAULT_PREFERENCES_PATH,
): Promise<LlmPreference> {
  try {
    const raw = await readFile(preferencesPath, 'utf8');
    const prefs = JSON.parse(raw) as {
      provider?: string | null;
      ollamaModel?: string | null;
    };
    let provider: LlmProvider | undefined;
    if (prefs.provider && prefs.provider !== 'auto' && isSupportedProvider(prefs.provider)) {
      provider = prefs.provider;
    }
    const model =
      provider === 'ollama' && typeof prefs.ollamaModel === 'string' && prefs.ollamaModel.trim()
        ? prefs.ollamaModel.trim()
        : null;
    return { provider, model };
  } catch {
    return { provider: undefined, model: null };
  }
}
