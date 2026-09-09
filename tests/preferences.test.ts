import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readLlmPreference } from '../src/lib/preferences.js';

function writePrefs(dir: string, body: unknown): string {
  const path = join(dir, 'preferences.json');
  writeFileSync(path, `${JSON.stringify(body)}\n`);
  return path;
}

describe('readLlmPreference', () => {
  it('returns auto-detect shape when the file is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pupila-prefs-'));
    const result = await readLlmPreference(join(dir, 'missing.json'));
    expect(result).toEqual({ provider: undefined, model: null });
  });

  it('treats provider auto / invalid as undefined', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pupila-prefs-'));
    expect(
      await readLlmPreference(writePrefs(dir, { provider: 'auto', ollamaModel: 'qwen3:14b' })),
    ).toEqual({
      provider: undefined,
      model: null,
    });
    expect(
      await readLlmPreference(
        writePrefs(dir, { provider: 'not-a-provider', ollamaModel: 'qwen3:14b' }),
      ),
    ).toEqual({ provider: undefined, model: null });
  });

  it('gates ollamaModel on provider === ollama', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pupila-prefs-'));
    expect(
      await readLlmPreference(writePrefs(dir, { provider: 'claude', ollamaModel: 'qwen3:14b' })),
    ).toEqual({ provider: 'claude', model: null });

    expect(
      await readLlmPreference(
        writePrefs(dir, { provider: 'ollama', ollamaModel: '  qwen3:14b  ' }),
      ),
    ).toEqual({ provider: 'ollama', model: 'qwen3:14b' });

    expect(
      await readLlmPreference(writePrefs(dir, { provider: 'ollama', ollamaModel: '' })),
    ).toEqual({ provider: 'ollama', model: null });
  });
});
