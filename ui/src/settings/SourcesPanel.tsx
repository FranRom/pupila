// [09] Job sources panel — add/remove company boards for the multi-slug ATS
// sources (Ashby, Greenhouse, Lever, Ashby-private). Personal choices persist
// as a delta in config/slugs.local.json (gitignored). Effective list per ATS =
// shipped ∪ add − remove.
//
// Two feedback signals, both run-independent:
//   - Verify (per company, on add) — live board count, pre-filter.
//   - Check board health (whole panel, on demand) — flags ONLY broken boards
//     (404 / unreachable). A healthy board with 0 open roles is NOT flagged —
//     companies go quiet between hiring waves, and that's not a reason to prune.

import { type FormEvent, useCallback, useState } from 'react';
import type {
  ProbeState,
  SourceHealthResponse,
  SourcesAtsView,
  SourcesResponse,
  VerifyResponse,
} from '../lib/api/index.ts';
import buttonStyles from '../styles/Button.module.css';
import styles from './SourcesPanel.module.css';
import { Section, SkeletonRows, settingsStyles } from './shared.tsx';

// Mirror of SLUG_PATTERN in src/lib/slugs.ts — the server re-validates, this is
// just for instant feedback.
const SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

const normalize = (raw: string): string => raw.trim().toLowerCase();

const healthKey = (key: string, slug: string): string => `${key}/${slug}`;

const BROKEN_LABEL: Record<Exclude<ProbeState, 'ok'>, string> = {
  not_found: 'board not found',
  error: 'board unreachable',
};

interface HealthEntry {
  state: ProbeState;
  found: number;
}
type HealthMap = Record<string, HealthEntry>;

interface SourcesPanelProps {
  sources: SourcesResponse | null;
  onSave: (key: string, add: string[], remove: string[]) => Promise<void>;
  onVerify: (key: string, slug: string) => Promise<VerifyResponse | null>;
  onCheckHealth: () => Promise<SourceHealthResponse | null>;
}

export function SourcesPanel({ sources, onSave, onVerify, onCheckHealth }: SourcesPanelProps) {
  const [health, setHealth] = useState<HealthMap>({});
  const [checked, setChecked] = useState(false);
  const [checking, setChecking] = useState(false);

  const total = sources?.ats.reduce((n, a) => n + a.effective.length, 0) ?? 0;

  const checkHealth = useCallback(async () => {
    setChecking(true);
    const res = await onCheckHealth();
    setChecking(false);
    if (!res) return;
    const next: HealthMap = {};
    for (const r of res.results)
      next[healthKey(r.key, r.slug)] = { state: r.state, found: r.found };
    setHealth(next);
    setChecked(true);
  }, [onCheckHealth]);

  return (
    <Section
      index="09"
      title="Job sources"
      subtitle="Add or remove company boards for the ATS sources. Saved to config/slugs.local.json."
      meta={sources ? <span className={settingsStyles.pill}>{total} companies</span> : null}
      action={
        sources ? (
          <button
            type="button"
            className={buttonStyles.secondary}
            disabled={checking}
            onClick={() => void checkHealth()}
          >
            {checking ? 'Checking…' : 'Check board health'}
          </button>
        ) : null
      }
    >
      {!sources ? (
        <SkeletonRows count={4} />
      ) : (
        <div className={styles.groups}>
          {sources.ats.map((ats) => (
            <AtsGroup
              key={ats.key}
              ats={ats}
              health={health}
              checked={checked}
              onSave={onSave}
              onVerify={onVerify}
            />
          ))}
        </div>
      )}
    </Section>
  );
}

interface AtsGroupProps {
  ats: SourcesAtsView;
  health: HealthMap;
  checked: boolean;
  onSave: (key: string, add: string[], remove: string[]) => Promise<void>;
  onVerify: (key: string, slug: string) => Promise<VerifyResponse | null>;
}

function AtsGroup({ ats, health, checked, onSave, onVerify }: AtsGroupProps) {
  const [draft, setDraft] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const addSet = new Set(ats.add);
  const entryFor = (slug: string): HealthEntry | undefined => health[healthKey(ats.key, slug)];

  // Per-group health summary: only meaningful once a check has run, and only
  // for probeable ATS. "N OK · M ⚠" — quiet (no badge) when nothing is broken.
  let summary: string | null = null;
  if (checked && ats.verifySupported) {
    const probed = ats.effective.map(entryFor).filter((e): e is HealthEntry => e !== undefined);
    if (probed.length > 0) {
      const bad = probed.filter((e) => e.state !== 'ok').length;
      summary = `${probed.length - bad} OK · ${bad} ⚠`;
    }
  }

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
    else if (result.state === 'not_found') setVerifyMsg(`✗ ${slug} — board not found.`);
    else if (result.state === 'error') setVerifyMsg(`✗ ${slug} — board unreachable, try again.`);
    else if (result.found > 0) setVerifyMsg(`✓ ${slug} — ${result.found} open role(s).`);
    else setVerifyMsg(`✓ ${slug} — board OK, no open roles right now.`);
  }, [ats.key, draft, onVerify]);

  return (
    <div className={styles.group}>
      <div className={styles.groupHead}>
        <span className={styles.groupTitle}>{ats.label}</span>
        <span className={styles.groupCount}>{summary ?? ats.effective.length}</span>
      </div>
      <div className={styles.chips}>
        {ats.effective.length === 0 ? (
          <span className={styles.emptyChips}>No companies — add one below.</span>
        ) : (
          ats.effective.map((slug) => {
            const entry = entryFor(slug);
            // Narrowing `entry.state !== 'ok'` here lets BROKEN_LABEL index safely.
            const brokenLabel = entry && entry.state !== 'ok' ? BROKEN_LABEL[entry.state] : null;
            const cls = brokenLabel
              ? styles.chipBroken
              : addSet.has(slug)
                ? styles.chipAdded
                : styles.chip;
            return (
              <span
                key={slug}
                className={cls}
                title={brokenLabel ? `${slug} — ${brokenLabel}` : undefined}
              >
                {brokenLabel && <span className={styles.chipWarn}>⚠</span>}
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
            );
          })
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
