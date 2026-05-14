import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { QueueRowStatus } from '../types.ts';
import { QueueBadge } from './QueueBadge.tsx';

// Behavior under test: the badge renders for in-flight states only.
// Terminal statuses (done/failed/cancelled) render nothing — the existing
// applied marker covers "done", and a tiny "failed/cancelled" badge in the
// Jobs table would add more noise than signal. Full lifecycle is in [08].

describe('QueueBadge', () => {
  it('renders nothing when status is null', () => {
    const { container } = render(<QueueBadge status={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each<QueueRowStatus>([
    'done',
    'failed',
    'cancelled',
  ])('renders nothing for terminal status %s', (status) => {
    const { container } = render(<QueueBadge status={status} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders "⏳ queued" badge for the queued status', () => {
    render(<QueueBadge status="queued" />);
    const badge = screen.getByText(/⏳ queued/);
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute('title', 'Queued for AI apply');
  });

  it('renders "⚙️ applying" badge for the running status', () => {
    render(<QueueBadge status="running" />);
    const badge = screen.getByText(/⚙️ applying/);
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute('title', 'AI apply in progress');
  });
});
