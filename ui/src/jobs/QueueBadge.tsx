// Inline badge for the Jobs table showing AI-apply queue state.
//
// Renders nothing for terminal states (done/failed/cancelled) — the
// existing applied-status marker covers "done", and a tiny badge for
// failed/cancelled would be more noise than signal in the jobs table.
// The full lifecycle is visible in the [08] Apply queue settings panel.

import type { QueueRowStatus } from '../types.ts';

interface QueueBadgeProps {
  status: QueueRowStatus | null;
}

export function QueueBadge({ status }: QueueBadgeProps) {
  if (status === null) return null;
  if (status === 'done' || status === 'failed' || status === 'cancelled') return null;
  if (status === 'queued') {
    return (
      <span className="badge badge-applied" title="Queued for AI apply">
        ⏳ queued
      </span>
    );
  }
  return (
    <span className="badge badge-applied badge-running" title="AI apply in progress">
      ⚙️ applying
    </span>
  );
}
