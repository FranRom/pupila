import type { AiReview, AppliedEntry, Job } from '../types.ts';
import { AiApplyPanel } from './AiApplyPanel.tsx';
import { AppliedBar } from './AppliedBar.tsx';
import { ReviewBody } from './ReviewBody.tsx';
import { SignalsList } from './SignalsList.tsx';
import type { AiApplyError, AiApplyResult, SetApplied } from './types.ts';

interface DetailPanelProps {
  job: Job;
  review: AiReview | undefined;
  applied: AppliedEntry | undefined;
  setApplied: SetApplied;
  aiApplyResult: AiApplyResult | null;
  aiApplyError: AiApplyError | null;
}

export function DetailPanel({
  job,
  review,
  applied,
  setApplied,
  aiApplyResult,
  aiApplyError,
}: DetailPanelProps) {
  return (
    <>
      <AppliedBar job={job} applied={applied} setApplied={setApplied} />
      {aiApplyError && (
        <div className="api-error" role="alert">
          AI Apply failed: {aiApplyError.error}
        </div>
      )}
      {aiApplyResult && <AiApplyPanel body={aiApplyResult.body} path={aiApplyResult.path} />}
      <div className="detail">
        <section>
          <h3>AI take</h3>
          {review ? (
            <ReviewBody review={review} />
          ) : (
            <p className="placeholder">
              No AI review yet — run <code>pnpm run ai-review</code> after the next pipeline run.
            </p>
          )}
        </section>
        <section>
          <h3>Score breakdown</h3>
          {job._signals ? (
            <SignalsList signals={job._signals} />
          ) : (
            <p className="placeholder">
              No <code>_signals</code> on this job (older entry).
            </p>
          )}
        </section>
        <section>
          <h3>Meta</h3>
          <dl className="meta">
            <dt>Location</dt>
            <dd>
              {job.location ?? '—'} {job.remote ? '· remote' : ''}
            </dd>
            <dt>Tags</dt>
            <dd>{job.tags.length ? job.tags.join(', ') : '—'}</dd>
            <dt>Posted</dt>
            <dd>{job.postedAt ? new Date(job.postedAt).toLocaleDateString() : 'unknown'}</dd>
            <dt>ID</dt>
            <dd className="mono">{job.id}</dd>
          </dl>
        </section>
      </div>
    </>
  );
}
