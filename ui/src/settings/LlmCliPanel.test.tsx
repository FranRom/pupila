import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LlmCliPanel } from './LlmCliPanel.tsx';
import type { EnvInfo, ProviderChoice } from './types.ts';

function envWith(ollamaModels: string[]): EnvInfo {
  return {
    node: 'v22.0.0',
    platform: 'darwin',
    repoRoot: '/repo',
    briefPresent: true,
    cvPresent: true,
    providers: { claude: false, codex: false, gemini: false, opencode: false, ollama: true },
    preferredProvider: 'ollama',
    ollamaModels,
    preferredOllamaModel: null,
  };
}

function renderPanel(opts: {
  provider: ProviderChoice;
  ollamaModel: string | null;
  models: string[];
}) {
  const onProviderChange = vi.fn();
  const onOllamaModelChange = vi.fn();
  render(
    <LlmCliPanel
      prefs={{ provider: opts.provider, ollamaModel: opts.ollamaModel, onboardedAt: '2026-01-01' }}
      envInfo={envWith(opts.models)}
      provider={opts.provider}
      ollamaModel={opts.ollamaModel}
      onProviderChange={onProviderChange}
      onOllamaModelChange={onOllamaModelChange}
      onSave={() => {}}
      onTest={() => {}}
      savingProvider={false}
      llmTest={{ busy: false, result: null }}
      savedToastVisible={false}
    />,
  );
  return { onProviderChange, onOllamaModelChange };
}

describe('LlmCliPanel — Ollama model', () => {
  it('keeps the saved model when switching to Auto-detect', () => {
    // Regression: clearing it left an ollama-only user with 2+ models and
    // provider=auto with no model, so every LLM path threw.
    const { onProviderChange, onOllamaModelChange } = renderPanel({
      provider: 'ollama',
      ollamaModel: 'qwen3:14b',
      models: ['gemma2:9b', 'qwen3:14b'],
    });
    fireEvent.click(screen.getByRole('radio', { name: /auto-detect/i }));
    expect(onProviderChange).toHaveBeenCalledWith('auto');
    expect(onOllamaModelChange).not.toHaveBeenCalled();
  });

  it('says which model auto-detect falls back to', () => {
    renderPanel({ provider: 'auto', ollamaModel: 'qwen3:14b', models: ['gemma2:9b', 'qwen3:14b'] });
    expect(screen.getByText(/used if auto-detect falls back to Ollama/i)).toBeTruthy();
  });

  it('explains a saved model that is no longer pulled', () => {
    renderPanel({ provider: 'ollama', ollamaModel: 'llama3:8b', models: ['qwen3:14b'] });
    expect(screen.getByText(/is no longer pulled/i)).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'qwen3:14b' })).toHaveProperty('checked', false);
  });
});
