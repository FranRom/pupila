// Tiny helpers shared by every Settings panel: section frame, skeleton
// placeholders, empty state, stat chip, provider chip, and the terminal
// $ ... block used by the scheduler panel.

import type { ReactNode } from 'react';
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
    <section className="settings-section">
      <header className="settings-section-header">
        <div className="settings-section-titles">
          <span className="settings-section-index">[{index}]</span>
          <div>
            <h2>{title}</h2>
            <p className="settings-section-subtitle">{subtitle}</p>
          </div>
        </div>
        <div className="settings-section-meta">
          {meta}
          {action}
        </div>
      </header>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

export function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="settings-skeleton" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders are static
        <div key={i} className="settings-skeleton-row" />
      ))}
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="settings-empty">
      <strong>{title}</strong>
      <p className="muted">{body}</p>
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
    <div className={`stat-chip ${accent ? 'stat-chip-accent' : ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

export function ProviderChip({ provider }: { provider: ProviderChoice }) {
  return <span className="settings-meta-pill settings-meta-pill-ok mono">{provider}</span>;
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
    <div className={`terminal-block ${danger ? 'terminal-block-danger' : ''}`}>
      <code className="terminal-block-line">
        <span className="terminal-block-prompt">$</span>
        <span className="terminal-block-cmd">{command}</span>
      </code>
      <div className="terminal-block-actions">
        <button
          type="button"
          className="terminal-block-copy"
          onClick={() => onCopy(command)}
          title="Copy command"
        >
          {copied ? '✓ copied' : 'Copy'}
        </button>
        <button
          type="button"
          className={`terminal-block-run ${danger ? 'terminal-block-run-danger' : ''}`}
          disabled={disabled || busy}
          onClick={onRun}
        >
          {busy ? 'Running…' : runLabel}
        </button>
      </div>
    </div>
  );
}
