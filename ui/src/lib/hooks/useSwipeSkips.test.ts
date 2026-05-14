import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiReviews } from '../../types.ts';
import { useSwipeSkips } from './useSwipeSkips.ts';

const STORAGE_KEY = 'jinder-ai-skip-overrides';

const skipReview: AiReviews = {
  jobAI: {
    jobId: 'jobAI',
    reviewedAt: '2026-05-01T00:00:00Z',
    model: 'test',
    summary: '',
    wants: [],
    offers: [],
    redFlags: [],
    verdict: 'skip',
    reason: '',
  },
};

function setup(overrides: Partial<Parameters<typeof useSwipeSkips>[0]> = {}) {
  const addSkip = vi.fn(async () => null);
  const removeSkip = vi.fn(async () => null);
  const onError = vi.fn();
  const { result, rerender } = renderHook(
    (props: Parameters<typeof useSwipeSkips>[0]) => useSwipeSkips(props),
    {
      initialProps: {
        swipeSkipIds: new Set<string>(),
        aiReviews: {},
        addSkip,
        removeSkip,
        onError,
        ...overrides,
      } as Parameters<typeof useSwipeSkips>[0],
    },
  );
  return { result, rerender, addSkip, removeSkip, onError };
}

describe('useSwipeSkips', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isJobSkipped truth table', () => {
    it('returns false for a vanilla job with no skips + no AI verdict', () => {
      const { result } = setup();
      expect(result.current.isJobSkipped('jobX')).toBe(false);
    });

    it('returns true for a job in swipeSkipIds', () => {
      const { result } = setup({ swipeSkipIds: new Set(['jobX']) });
      expect(result.current.isJobSkipped('jobX')).toBe(true);
    });

    it("returns true for a job with AI verdict 'skip' (no override)", () => {
      const { result } = setup({ aiReviews: skipReview });
      expect(result.current.isJobSkipped('jobAI')).toBe(true);
    });

    it("returns false when the user has overridden the AI 'skip' verdict", () => {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(['jobAI']));
      const { result } = setup({ aiReviews: skipReview });
      expect(result.current.isJobSkipped('jobAI')).toBe(false);
    });
  });

  describe('toggleSkip', () => {
    it('SKIPS an unskipped job via the server', async () => {
      const { result, addSkip } = setup();
      await act(async () => {
        await result.current.toggleSkip('jobX');
      });
      expect(addSkip).toHaveBeenCalledWith('jobX');
    });

    it('UNSKIPS a server-skipped job via the server', async () => {
      const { result, removeSkip } = setup({ swipeSkipIds: new Set(['jobX']) });
      await act(async () => {
        await result.current.toggleSkip('jobX');
      });
      expect(removeSkip).toHaveBeenCalledWith('jobX');
    });

    it('adds an AI-skip override locally (no server call) when unskipping an AI-skipped job', async () => {
      const { result, addSkip, removeSkip } = setup({ aiReviews: skipReview });
      await act(async () => {
        await result.current.toggleSkip('jobAI');
      });
      expect(addSkip).not.toHaveBeenCalled();
      expect(removeSkip).not.toHaveBeenCalled();
      expect(result.current.aiSkipOverrides.has('jobAI')).toBe(true);
    });

    it('lifts an AI-skip override locally when re-skipping (no server call)', async () => {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(['jobAI']));
      const { result, addSkip } = setup({ aiReviews: skipReview });
      // Currently un-skipped because of the override. Skipping again removes
      // the override locally.
      await act(async () => {
        await result.current.toggleSkip('jobAI');
      });
      expect(addSkip).not.toHaveBeenCalled();
      expect(result.current.aiSkipOverrides.has('jobAI')).toBe(false);
    });

    it('reports onError when the server skip request fails', async () => {
      const failingAdd = vi.fn(async () => 'HTTP 500');
      const { result, onError } = setup({ addSkip: failingAdd });
      await act(async () => {
        await result.current.toggleSkip('jobX');
      });
      expect(onError).toHaveBeenCalledWith(expect.stringContaining('Could not skip'));
    });
  });

  describe('localStorage persistence', () => {
    it('writes aiSkipOverrides to localStorage on change', async () => {
      const { result } = setup({ aiReviews: skipReview });
      await act(async () => {
        await result.current.toggleSkip('jobAI');
      });
      const raw = window.localStorage.getItem(STORAGE_KEY);
      expect(raw).toBeTruthy();
      const stored = JSON.parse(raw ?? '[]') as string[];
      expect(stored).toContain('jobAI');
    });

    it('reads aiSkipOverrides from localStorage on first mount', () => {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(['jobAI']));
      const { result } = setup({ aiReviews: skipReview });
      expect(result.current.aiSkipOverrides.has('jobAI')).toBe(true);
    });
  });
});
