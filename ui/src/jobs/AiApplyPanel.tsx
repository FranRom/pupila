import { useMemo } from 'react';
import styles from './AiApplyPanel.module.css';

interface AiApplyPanelProps {
  body: string;
  path: string | null;
}

interface MarkdownSection {
  heading: string;
  body: string;
}

function splitMarkdownByH2(md: string): MarkdownSection[] {
  const lines = md.split('\n');
  const out: MarkdownSection[] = [];
  let current: MarkdownSection | null = null;
  for (const line of lines) {
    const m = line.match(/^##\s+(.+)$/);
    if (m?.[1]) {
      if (current) out.push(current);
      current = { heading: m[1].trim(), body: '' };
    } else if (current) {
      current.body += `${line}\n`;
    }
  }
  if (current) out.push(current);
  return out;
}

// Renders the AI Apply markdown package with a copy-to-clipboard button per
// `## Section`. The user copy/pastes each section into the actual application
// form. (Phase 2: replace this with a "Submit via Playwright" flow that
// auto-fills the live application.)
export function AiApplyPanel({ body, path }: AiApplyPanelProps) {
  const sections = useMemo(() => splitMarkdownByH2(body), [body]);
  return (
    <div className={styles.panel}>
      <header>
        <strong>✨ AI Apply package</strong>
        {path && <span className={styles.muted}> · saved to {path}</span>}
      </header>
      {sections.length === 0 ? (
        <pre className={styles.raw}>{body}</pre>
      ) : (
        sections.map((s) => (
          <section key={s.heading} className={styles.section}>
            <header>
              <h4>{s.heading}</h4>
              <button
                type="button"
                className={styles.copy}
                onClick={() => {
                  void navigator.clipboard.writeText(s.body.trim());
                }}
              >
                Copy
              </button>
            </header>
            <pre>{s.body.trim()}</pre>
          </section>
        ))
      )}
    </div>
  );
}
