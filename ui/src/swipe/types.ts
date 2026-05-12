// Local types for the Tik Tjob swipe deck. Kept narrow on purpose —
// shared types live in ../types.ts (Job, JobSignals, ApplyQueueResponse,
// QueueRow, JobBodyResponse, QUEUE_STATUS_EMOJI). Don't duplicate those here.

import type { Job } from '../types.ts';

export interface SwipeDirection {
  axis: 'left' | 'right';
}

export type SwipeAction = 'apply' | 'skip';

/** A job that has been pre-paired with its full body for the visible card. */
export interface DeckJob {
  job: Job;
  body: string;
}
