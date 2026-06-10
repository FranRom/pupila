import clsx from 'clsx';
import { useEffect, useId, useState } from 'react';
import { InfoTooltip } from './components/InfoTooltip.tsx';
import { COUNTRIES, regionsForCountry } from './constants/countries.ts';
import styles from './LocationPreferences.module.css';
import buttonStyles from './styles/Button.module.css';
import { type LocationProfile, WORK_TYPES, type WorkType } from './types.ts';

const WORK_TYPE_LABELS: Record<WorkType, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
};

interface LocationPreferencesProps {
  location: LocationProfile;
  loading: boolean;
  saving: boolean;
  onSave: (next: LocationProfile) => void;
  /** Location was edited since the last fetch — show the re-score prompt. */
  dirty?: boolean;
  /** Trigger a full re-score (aggregator run) against the current location. */
  onRescore?: () => void;
  /** A re-score run is in flight. */
  rescoring?: boolean;
}

/**
 * Editable location preferences: where the candidate lives (single country,
 * combobox with free-text fallback) and the work arrangements they accept.
 * Drives the persona-neutral geo filter.
 *
 * Based-in is the primary control: setting/changing it auto-derives the
 * `acceptedRegions` (e.g. Spain → europe / emea / eu / spain). Those regions are
 * what the filter actually matches on, but most users never need to touch them —
 * they live behind a collapsed "Customize" disclosure for the cases where reach
 * differs from country (e.g. also open to US-remote, or a specific timezone).
 */
export function LocationPreferences({
  location,
  loading,
  saving,
  onSave,
  dirty,
  onRescore,
  rescoring,
}: LocationPreferencesProps) {
  const [draft, setDraft] = useState<LocationProfile>(location);
  const [basedInInput, setBasedInInput] = useState(location.basedIn);
  const [addingRegion, setAddingRegion] = useState('');
  const countryListId = useId();

  // Adopt server-validated state whenever the loaded value changes.
  useEffect(() => {
    setDraft(location);
    setBasedInInput(location.basedIn);
  }, [location]);

  const commit = (next: LocationProfile) => {
    setDraft(next);
    onSave(next);
  };

  // Commit basedIn on blur / selection. Changing your country re-derives the
  // accepted regions from it (Based-in is the primary control); custom tweaks in
  // the "Customize" disclosure are intentionally reset on a country change.
  const commitBasedIn = () => {
    const basedIn = basedInInput.trim();
    if (basedIn === draft.basedIn) return;
    commit({ ...draft, basedIn, acceptedRegions: regionsForCountry(basedIn) });
  };

  const resetRegionsFromCountry = () =>
    commit({ ...draft, acceptedRegions: regionsForCountry(draft.basedIn) });

  const toggleWorkType = (t: WorkType) => {
    const has = draft.workTypes.includes(t);
    const workTypes = has ? draft.workTypes.filter((w) => w !== t) : [...draft.workTypes, t];
    commit({ ...draft, workTypes });
  };

  const addRegion = () => {
    const region = addingRegion.trim().toLowerCase();
    setAddingRegion('');
    if (!region || draft.acceptedRegions.includes(region)) return;
    commit({ ...draft, acceptedRegions: [...draft.acceptedRegions, region] });
  };

  const removeRegion = (region: string) =>
    commit({ ...draft, acceptedRegions: draft.acceptedRegions.filter((r) => r !== region) });

  const toggleExclude = () =>
    commit({ ...draft, excludeOutsideAcceptedRegions: !draft.excludeOutsideAcceptedRegions });

  return (
    <section className={styles.card}>
      <header className={styles.header}>
        <h3>Location</h3>
        <span className={styles.muted}>Where you are and the work you'll take.</span>
      </header>

      {loading ? (
        <p className={styles.muted}>Loading…</p>
      ) : (
        <>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${countryListId}-input`}>
              Based in
            </label>
            <input
              id={`${countryListId}-input`}
              className={styles.textInput}
              list={countryListId}
              placeholder="Your country (e.g. Spain)"
              value={basedInInput}
              onChange={(e) => setBasedInInput(e.target.value)}
              onBlur={commitBasedIn}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
            <datalist id={countryListId}>
              {COUNTRIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Work types</span>
            <div className={styles.workTypes}>
              {WORK_TYPES.map((t) => {
                const active = draft.workTypes.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    className={active ? styles.workTypeActive : styles.workType}
                    aria-pressed={active}
                    onClick={() => toggleWorkType(t)}
                  >
                    {WORK_TYPE_LABELS[t]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className={styles.field}>
            <span className={styles.labelRow}>
              <span className={styles.label}>Accepted regions</span>
              <InfoTooltip
                ariaLabel="About accepted regions"
                content={
                  <>
                    The regions a job can be tied to and still match you — derived from your
                    country. A location-restricted job is kept only if it names one of these (or is
                    worldwide-remote); otherwise it's dropped when “Only show jobs in my accepted
                    regions” is on, or score-penalized when off. Customize below if your reach
                    differs from your country (e.g. also open to <strong>US</strong>, or a specific
                    timezone like <strong>CET</strong>).
                  </>
                }
              />
            </span>
            <p className={styles.regionsPreview}>
              {draft.acceptedRegions.length > 0 ? (
                draft.acceptedRegions.join(', ')
              ) : (
                <span className={styles.muted}>
                  None — set a country above, or customize below.
                </span>
              )}
            </p>

            <details className={styles.customize}>
              <summary className={styles.summary}>
                Customize regions ({draft.acceptedRegions.length})
              </summary>
              <div className={styles.chips}>
                {draft.acceptedRegions.map((r) => (
                  <span key={r} className={styles.chip}>
                    <span className={styles.chipLabel}>{r}</span>
                    <button
                      type="button"
                      className={styles.chipRemove}
                      onClick={() => removeRegion(r)}
                      aria-label={`Remove ${r}`}
                      title="Remove"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className={styles.addRow}>
                <input
                  className={styles.addInput}
                  placeholder="Add a region (e.g. Europe, EMEA, US, Remote)"
                  value={addingRegion}
                  onChange={(e) => setAddingRegion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addRegion();
                  }}
                />
                <button
                  type="button"
                  className={clsx(buttonStyles.secondary, buttonStyles.sm)}
                  disabled={!addingRegion.trim()}
                  onClick={addRegion}
                >
                  Add region
                </button>
                <button
                  type="button"
                  className={clsx(buttonStyles.primary, buttonStyles.sm)}
                  disabled={!draft.basedIn.trim()}
                  onClick={resetRegionsFromCountry}
                  title="Replace with the defaults for your country"
                >
                  ↺ Reset from country
                </button>
                {saving && <span className={styles.muted}>Saving…</span>}
              </div>
            </details>
          </div>

          <label className={styles.toggleRow}>
            <input
              type="checkbox"
              checked={draft.excludeOutsideAcceptedRegions}
              onChange={toggleExclude}
            />
            <span>
              Only show jobs in my accepted regions
              <span className={styles.muted}>
                {' '}
                — off keeps out-of-region jobs but penalizes their score.
              </span>
            </span>
          </label>

          {dirty && onRescore && (
            <div className={styles.rescore}>
              <span className={styles.muted}>
                Location changed — re-score jobs to apply (re-runs the aggregator).
              </span>
              <button
                type="button"
                className={clsx(buttonStyles.primary, buttonStyles.sm)}
                onClick={onRescore}
                disabled={rescoring}
              >
                {rescoring ? 'Re-scoring…' : 'Re-score jobs →'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
