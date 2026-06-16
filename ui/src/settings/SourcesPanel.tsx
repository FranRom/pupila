// [09] Job sources panel — add/remove company boards for the multi-slug ATS
// sources (Ashby, Greenhouse, Lever, Ashby-private). Personal choices persist
// as a delta in config/slugs.local.json (gitignored). Effective list per ATS =
// shipped ∪ add − remove. Verify hits the live ATS board to confirm a slug.

import { type FormEvent, useCallback, useState } from 'react';
import type { SourcesAtsView, SourcesResponse, VerifyResponse } from '../lib/api/index.ts';
import buttonStyles from '../styles/Button.module.css';
import styles from './SourcesPanel.module.css';
import { Section, SkeletonRows, settingsStyles } from './shared.tsx';

// Mirror of SLUG_PATTERN in src/lib/slugs.ts — the server re-validates, this is
// just for instant feedback.
const SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

const normalize = (raw: string): string => raw.trim().toLowerCase();

interface SourcesPanelProps {
  sources: SourcesResponse | null;
  onSave: (key: string, add: string[], remove: string[]) => Promise<void>;
  onVerify: (key: string, slug: string) => Promise<VerifyResponse | null>;
}

export function SourcesPanel({ sources, onSave, onVerify }: SourcesPanelProps) {
  const total = sources?.ats.reduce((n, a) => n + a.effective.length, 0) ?? 0;
  return (
    <Section
      index="09"
      title="Job sources"
      subtitle="Add or remove company boards for the ATS sources. Saved to config/slugs.local.json."
      meta={sources ? <span className={settingsStyles.pill}>{total} companies</span> : null}
    >
      {!sources ? (
        <SkeletonRows count={4} />
      ) : (
        <div className={styles.groups}>
          {sources.ats.map((ats) => (
            <AtsGroup key={ats.key} ats={ats} onSave={onSave} onVerify={onVerify} />
          ))}
        </div>
      )}
    </Section>
  );
}

interface AtsGroupProps {
  ats: SourcesAtsView;
  onSave: (key: string, add: string[], remove: string[]) => Promise<void>;
  onVerify: (key: string, slug: string) => Promise<VerifyResponse | null>;
}

function AtsGroup({ ats, onSave, onVerify }: AtsGroupProps) {
  const [draft, setDraft] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const addSet = new Set(ats.add);

  const removeSlug = useCallback(
    (slug: string) => {
      if (addSet.has(slug)) {
        void onSave(
          ats.key,
          ats.add.filter((s) => s !== slug),
          ats.remove,
        );
      } else {
        void onSave(ats.key, ats.add, [...ats.remove, slug]);
      }
    },
    [ats, addSet, onSave],
  );

  const submitAdd = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      setVerifyMsg(null);
      const slug = normalize(draft);
      if (!SLUG_PATTERN.test(slug)) {
        setLocalError('Invalid slug — use lowercase letters, digits, dot, dash, underscore.');
        return;
      }
      if (ats.effective.includes(slug)) {
        setLocalError('Already in the list.');
        return;
      }
      setLocalError(null);
      void onSave(
        ats.key,
        [...ats.add, slug],
        ats.remove.filter((s) => s !== slug),
      );
      setDraft('');
    },
    [ats, draft, onSave],
  );

  const runVerify = useCallback(async () => {
    const slug = normalize(draft);
    if (!SLUG_PATTERN.test(slug)) {
      setLocalError('Enter a slug to verify.');
      return;
    }
    setLocalError(null);
    setVerifying(true);
    setVerifyMsg(null);
    const result = await onVerify(ats.key, slug);
    setVerifying(false);
    if (!result) setVerifyMsg('Verify failed — try again.');
    else if (!result.supported) setVerifyMsg('Verify not supported for this source.');
    else if (result.found > 0) setVerifyMsg(`✓ ${slug} — ${result.found} open role(s).`);
    else setVerifyMsg(`✗ ${slug} — board not found or no open roles.`);
  }, [ats.key, draft, onVerify]);

  return (
    <div className={styles.group}>
      <div className={styles.groupHead}>
        <span className={styles.groupTitle}>{ats.label}</span>
        <span className={styles.groupCount}>{ats.effective.length}</span>
      </div>
      <div className={styles.chips}>
        {ats.effective.length === 0 ? (
          <span className={styles.emptyChips}>No companies — add one below.</span>
        ) : (
          ats.effective.map((slug) => (
            <span key={slug} className={addSet.has(slug) ? styles.chipAdded : styles.chip}>
              {slug}
              <button
                type="button"
                className={styles.chipRemove}
                title={`Remove ${slug}`}
                onClick={() => removeSlug(slug)}
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>
      <form className={styles.addRow} onSubmit={submitAdd}>
        <input
          className={styles.input}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setLocalError(null);
          }}
          placeholder={`Add ${ats.label} company slug…`}
          spellCheck={false}
          autoCapitalize="none"
        />
        {ats.verifySupported && (
          <button
            type="button"
            className={buttonStyles.secondary}
            disabled={verifying || !draft.trim()}
            onClick={() => void runVerify()}
          >
            {verifying ? 'Verifying…' : 'Verify'}
          </button>
        )}
        <button type="submit" className={buttonStyles.primary} disabled={!draft.trim()}>
          Add
        </button>
      </form>
      {localError && <p className={styles.error}>{localError}</p>}
      {verifyMsg && <p className={styles.verify}>{verifyMsg}</p>}
    </div>
  );
}
