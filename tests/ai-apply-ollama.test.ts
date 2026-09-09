import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const runOllamaMock = vi.fn();
const detectLlmCliMock = vi.fn();

vi.mock('../src/lib/llm.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/llm.js')>();
  return {
    ...actual,
    detectLlmCli: (...args: unknown[]) => detectLlmCliMock(...args),
    runOllama: (...args: unknown[]) => runOllamaMock(...args),
  };
});

import { runAiApplyForJob } from '../src/lib/ai-apply.js';

const JOB_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function fixtureRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'pupila-ai-apply-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'config'), { recursive: true });
  writeFileSync(
    join(root, 'data', 'jobs.json'),
    JSON.stringify([
      {
        id: JOB_ID,
        title: 'Senior Frontend Engineer',
        company: 'Acme',
        url: 'https://example.com/j',
        location: 'Remote',
        fitScore: 80,
        source: 'ashby',
        postedAt: null,
        tags: [],
        categories: [],
        salary: null,
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
      },
    ]),
  );
  writeFileSync(
    join(root, 'config', 'candidate-brief.md'),
    '<!-- candidate-brief:start -->\nSenior FE eng.\n<!-- candidate-brief:end -->\n',
  );
  writeFileSync(join(root, 'config', 'cv.txt'), 'My CV text\n');
  return root;
}

describe('runAiApplyForJob — ollama error surfacing', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not wrap ollama timeout errors as spawn failed', async () => {
    detectLlmCliMock.mockResolvedValue({
      provider: 'ollama',
      cmd: 'ollama',
      argTemplate: [],
    });
    runOllamaMock.mockRejectedValue(
      new Error(
        'ollama timed out after 0s (model qwen3:14b). Override with PUPILA_LLM_TIMEOUT_MS=<ms>.',
      ),
    );

    const repoRoot = fixtureRepo();
    let caught: unknown;
    try {
      await runAiApplyForJob({ jobId: JOB_ID, repoRoot, provider: 'ollama', model: 'qwen3:14b' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).toMatch(/^Error: ollama timed out/);
    expect(String(caught)).not.toContain('spawn failed');
  });
});
