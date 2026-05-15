// Tiny helpers shared by every Settings panel: section frame, skeleton
// placeholders, empty state, stat chip, provider chip, and the terminal
// $ ... block used by the scheduler panel.

import clsx from 'clsx';
import type { ReactNode } from 'react';
import styles from './settings.module.css';
import type { ProviderChoice } from './types.ts';

interface SectionProps {
  index: string;
  title: string;
  subtitle: string;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}

export function Section({ index, title, subtitle, meta, action, children }: SectionProps) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        <div className={styles.sectionTitles}>
          <span className={styles.sectionIndex}>[{index}]</span>
          <div>
            <h2>{title}</h2>
            <p className={styles.sectionSubtitle}>{subtitle}</p>
          </div>
        </div>
        <div className={styles.sectionMeta}>
          {meta}
          {action}
        </div>
      </header>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

export function SkeletonRows({ count }: { count: number }) {
  return (
    <div className={styles.skeleton} aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders are static
        <div key={i} className={styles.skeletonRow} />
      ))}
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className={styles.empty}>
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

interface StatProps {
  label: string;
  value: string;
  accent?: boolean;
}

export function Stat({ label, value, accent }: StatProps) {
  return (
    <div className={accent ? styles.statAccent : styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
    </div>
  );
}

export function ProviderChip({ provider }: { provider: ProviderChoice }) {
  return <span className={clsx(styles.pillMono, styles.pillOk)}>{provider}</span>;
}

interface TerminalBlockProps {
  command: string;
  busy: boolean;
  disabled: boolean;
  onRun: () => void;
  onCopy: (cmd: string) => void;
  copied: boolean;
  runLabel: string;
  danger?: boolean;
}

export function TerminalBlock({
  command,
  busy,
  disabled,
  onRun,
  onCopy,
  copied,
  runLabel,
  danger,
}: TerminalBlockProps) {
  return (
    <div className={danger ? styles.terminalDanger : styles.terminal}>
      <code className={styles.terminalLine}>
        <span className={styles.terminalPrompt}>$</span>
        <span className={styles.terminalCmd}>{command}</span>
      </code>
      <div className={styles.terminalActions}>
        <button
          type="button"
          className={styles.terminalCopy}
          onClick={() => onCopy(command)}
          title="Copy command"
        >
          {copied ? '✓ copied' : 'Copy'}
        </button>
        <button
          type="button"
          className={danger ? styles.terminalRunDanger : styles.terminalRun}
          disabled={disabled || busy}
          onClick={onRun}
        >
          {busy ? 'Running…' : runLabel}
        </button>
      </div>
    </div>
  );
}

// Re-export the styles object so panels can use shared classes (.actions,
// .toast, .pill*, .stat etc.) without importing the .module.css themselves.
export { styles as settingsStyles };
