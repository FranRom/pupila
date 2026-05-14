import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppliedEntry, Job } from '../types.ts';
import { AppliedBar } from './AppliedBar.tsx';

const job: Job = {
  id: 'job1',
  source: 'ashby',
  title: 'Senior Frontend Engineer',
  company: 'Acme',
  url: 'https://example.com/job1',
  location: 'Remote',
  remote: true,
  tags: [],
  salary: null,
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  postedAt: null,
  fetchedAt: '2026-05-01T00:00:00Z',
  fitScore: 80,
  category: 'general',
};

const appliedEntry: AppliedEntry = {
  url: job.url,
  status: 'applied',
  date: '2026-05-01',
  notes: 'phone screen booked',
};

function renderBar(overrides: Partial<Parameters<typeof AppliedBar>[0]> = {}) {
  const setApplied = vi.fn(async () => undefined);
  const toggleSkip = vi.fn();
  const cancelQueueRow = vi.fn(async () => undefined);
  const enqueueJob = vi.fn(async () => undefined);
  const props = {
    job,
    applied: undefined,
    isSkipped: false,
    queueStatus: null,
    setApplied,
    toggleSkip,
    cancelQueueRow,
    enqueueJob,
    ...overrides,
  } as Parameters<typeof AppliedBar>[0];
  render(<AppliedBar {...props} />);
  return { setApplied, toggleSkip, cancelQueueRow, enqueueJob };
}

describe('AppliedBar', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('not-applied state', () => {
    it('shows "Not applied" label and no notes input', () => {
      renderBar();
      expect(screen.getByText('Not applied')).toBeInTheDocument();
      expect(screen.queryByPlaceholderText(/notes/)).not.toBeInTheDocument();
    });

    it('clicking a status pill calls setApplied(job, status)', () => {
      const { setApplied } = renderBar();
      fireEvent.click(screen.getByTitle('Mark as applied'));
      expect(setApplied).toHaveBeenCalledWith(job, 'applied');
    });
  });

  describe('applied state — pill toggle', () => {
    it('marks the active pill with aria-pressed and a check', () => {
      renderBar({ applied: appliedEntry });
      const activePill = screen.getByRole('button', { name: /applied/, pressed: true });
      expect(activePill).toBeInTheDocument();
      expect(activePill.textContent).toContain('✓');
    });

    it('clicking the active pill clears the entry (calls setApplied(job, null))', () => {
      const { setApplied } = renderBar({ applied: appliedEntry });
      const activePill = screen.getByRole('button', { name: /applied/, pressed: true });
      fireEvent.click(activePill);
      expect(setApplied).toHaveBeenCalledWith(job, null);
    });

    it('renders a top-level "clear" button when applied', () => {
      const { setApplied } = renderBar({ applied: appliedEntry });
      fireEvent.click(screen.getByTitle('Clear status'));
      expect(setApplied).toHaveBeenCalledWith(job, null);
    });
  });

  describe('notes input', () => {
    it('hydrates from applied.notes', () => {
      renderBar({ applied: appliedEntry });
      const input = screen.getByPlaceholderText(/notes/) as HTMLInputElement;
      expect(input.value).toBe('phone screen booked');
    });

    it('persists on blur when the value changed', () => {
      const { setApplied } = renderBar({ applied: appliedEntry });
      const input = screen.getByPlaceholderText(/notes/);
      fireEvent.change(input, { target: { value: 'recruiter call Friday' } });
      fireEvent.blur(input);
      expect(setApplied).toHaveBeenCalledWith(job, 'applied', 'recruiter call Friday');
    });

    it('does NOT persist on blur when the value is unchanged', () => {
      const { setApplied } = renderBar({ applied: appliedEntry });
      const input = screen.getByPlaceholderText(/notes/);
      fireEvent.blur(input);
      expect(setApplied).not.toHaveBeenCalled();
    });

    it('Enter triggers blur and persists', () => {
      const { setApplied } = renderBar({ applied: appliedEntry });
      const input = screen.getByPlaceholderText(/notes/) as HTMLInputElement;
      input.focus();
      fireEvent.change(input, { target: { value: 'updated' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      // The keyDown handler calls blur() on the focused input, which fires
      // the onBlur persist path.
      expect(setApplied).toHaveBeenCalledWith(job, 'applied', 'updated');
    });
  });

  describe('skip toggle', () => {
    it('calls toggleSkip(job.id) when the skip pill is clicked', () => {
      const { toggleSkip } = renderBar();
      fireEvent.click(screen.getByTitle('Skip from Jinder'));
      expect(toggleSkip).toHaveBeenCalledWith(job.id);
    });

    it('renders "skipped" with aria-pressed when isSkipped is true', () => {
      renderBar({ isSkipped: true });
      const pill = screen.getByRole('button', { name: /skipped/, pressed: true });
      expect(pill).toBeInTheDocument();
    });
  });

  describe('queue button branches', () => {
    it('renders "queue" button when no queue status', () => {
      const { enqueueJob } = renderBar();
      const btn = screen.getByTitle(/Queue this job for AI Apply/);
      fireEvent.click(btn);
      expect(enqueueJob).toHaveBeenCalledWith(job.id);
    });

    it('renders "remove from queue" when queued', () => {
      const { cancelQueueRow } = renderBar({ queueStatus: 'queued' });
      const btn = screen.getByTitle(/Remove from the AI Apply queue/);
      fireEvent.click(btn);
      expect(cancelQueueRow).toHaveBeenCalledWith(job.id);
    });

    it('renders "cancel apply" when running', () => {
      const { cancelQueueRow } = renderBar({ queueStatus: 'running' });
      const btn = screen.getByTitle(/Cancel the in-flight AI Apply run/);
      fireEvent.click(btn);
      expect(cancelQueueRow).toHaveBeenCalledWith(job.id);
    });

    it('renders no queue button when status is done', () => {
      renderBar({ queueStatus: 'done' });
      expect(screen.queryByTitle(/Queue this job for AI Apply/)).not.toBeInTheDocument();
      expect(screen.queryByTitle(/Cancel the in-flight AI Apply run/)).not.toBeInTheDocument();
      expect(screen.queryByTitle(/Remove from the AI Apply queue/)).not.toBeInTheDocument();
    });
  });
});
