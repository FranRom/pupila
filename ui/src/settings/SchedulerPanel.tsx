// [02] Scheduler panel — read state + install/uninstall daily agents.

import clsx from 'clsx';
import { relativeTime } from '../format.ts';
import styles from './SchedulerPanel.module.css';
import { Section, SkeletonRows, settingsStyles, TerminalBlock } from './shared.tsx';
import type { SchedulerStatus } from './types.ts';

interface SchedulerPanelProps {
  scheduler: SchedulerStatus | null;
  schedulerOp: 'install' | 'uninstall' | null;
  skipReview: boolean;
  onSkipReviewChange: (next: boolean) => void;
  onAskInstall: () => void;
  onAskUninstall: () => void;
  copy: (cmd: string) => void;
  copiedSnippet: string | null;
}

export function SchedulerPanel({
  scheduler,
  schedulerOp,
  skipReview,
  onSkipReviewChange,
  onAskInstall,
  onAskUninstall,
  copy,
  copiedSnippet,
}: SchedulerPanelProps) {
  const schedulerBusy = schedulerOp !== null;
  return (
    <Section
      index="02"
      title="Scheduler"
      subtitle="Run the daily aggregator and AI review without opening this UI."
      meta={
        scheduler ? <span className={settingsStyles.pillMono}>{scheduler.platform}</span> : null
      }
    >
      {!scheduler ? (
        <SkeletonRows count={2} />
      ) : (
        <>
          <div className={styles.grid}>
            <SchedulerRow
              label="Aggregator"
              cmd="pnpm run dev"
              installed={scheduler.installed.aggregate}
              lastRun={scheduler.lastRun.aggregate}
            />
            <SchedulerRow
              label="AI review"
              cmd="pnpm run ai-review"
              installed={scheduler.installed.review}
              lastRun={scheduler.lastRun.review}
            />
          </div>

          {scheduler.platform === 'other' ? (
            <p className={styles.warn}>
              Unknown platform — only macOS and Linux scheduler scripts are bundled.
            </p>
          ) : (
            <>
              <TerminalBlock
                command={skipReview ? `${scheduler.installCmd} --no-review` : scheduler.installCmd}
                busy={schedulerOp === 'install'}
                disabled={schedulerBusy}
                onRun={onAskInstall}
                onCopy={copy}
                copied={
                  copiedSnippet ===
                  (skipReview ? `${scheduler.installCmd} --no-review` : scheduler.installCmd)
                }
                runLabel={
                  scheduler.installed.aggregate || scheduler.installed.review
                    ? 'Reinstall'
                    : 'Install'
                }
              />
              <label className={clsx(styles.checkbox)}>
                <input
                  type="checkbox"
                  checked={skipReview}
                  onChange={(e) => onSkipReviewChange(e.target.checked)}
                  disabled={schedulerBusy}
                />
                Skip the AI review agent (<code>--no-review</code>) — useful if you don't have an
                LLM CLI installed.
              </label>

              {(scheduler.installed.aggregate || scheduler.installed.review) && (
                <TerminalBlock
                  command={scheduler.uninstallCmd}
                  busy={schedulerOp === 'uninstall'}
                  disabled={schedulerBusy}
                  onRun={onAskUninstall}
                  onCopy={copy}
                  copied={copiedSnippet === scheduler.uninstallCmd}
                  runLabel="Uninstall"
                  danger
                />
              )}
            </>
          )}
        </>
      )}
    </Section>
  );
}

interface SchedulerRowProps {
  label: string;
  cmd: string;
  installed: boolean;
  lastRun: string | null;
}

function SchedulerRow({ label, cmd, installed, lastRun }: SchedulerRowProps) {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <span className={styles.label}>{label}</span>
        <code className={styles.cmd}>{cmd}</code>
      </div>
      <span className={installed ? styles.pillOn : styles.pillOff}>
        {installed ? 'loaded' : 'not loaded'}
      </span>
      <span className={styles.lastrun}>
        {lastRun ? `last run ${relativeTime(lastRun)}` : 'never run'}
      </span>
    </div>
  );
}
