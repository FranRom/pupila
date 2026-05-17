import { describe, expect, it } from 'vitest';
import { detectLegacyEnvVars } from '../src/legacy-env.js';

describe('detectLegacyEnvVars', () => {
  it('returns empty when no JOB_HUNT_* env vars set', () => {
    expect(detectLegacyEnvVars({ HOME: '/x', PATH: '/y' })).toEqual([]);
  });

  it('detects all known legacy env vars', () => {
    const env = {
      JOB_HUNT_LLM: 'claude',
      JOB_HUNT_NO_BRIEF_CHECK: '1',
      JOB_HUNT_CV_MAX_CHARS: '20000',
      UNRELATED: 'x',
    };
    const result = detectLegacyEnvVars(env);
    expect(result).toEqual(
      expect.arrayContaining([
        { old: 'JOB_HUNT_LLM', replacement: 'PUPILA_LLM' },
        { old: 'JOB_HUNT_NO_BRIEF_CHECK', replacement: 'PUPILA_NO_BRIEF_CHECK' },
        { old: 'JOB_HUNT_CV_MAX_CHARS', replacement: 'PUPILA_CV_MAX_CHARS' },
      ]),
    );
    expect(result).toHaveLength(3);
  });

  it('ignores unrelated env vars', () => {
    expect(detectLegacyEnvVars({ JOBS_PATH: '/x' })).toEqual([]);
  });
});
