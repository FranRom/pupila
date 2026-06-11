import clsx from 'clsx';
import { useEffect, useState } from 'react';
import styles from './CategoryPreferences.module.css';
import { InfoTooltip } from './components/InfoTooltip.tsx';
import buttonStyles from './styles/Button.module.css';
import { CATEGORY_SCOPES, type CategoryDef, type CategoryScope } from './types.ts';

const MAX_WEIGHT = 50;

function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Seed a category from a free-text label. The lowercased label becomes the first
// keyword so the category isn't empty (the server drops keyword-less categories)
// and immediately matches its own name. id is derived once and stays stable
// (it's the key stored on jobs); rename edits only the display label.
function categoryFromLabel(label: string): CategoryDef | null {
  const trimmed = label.trim();
  const id = slugify(trimmed);
  if (!trimmed || !id) return null;
  return { id, label: trimmed, keywords: [trimmed.toLowerCase()], weight: 0 };
}

const SCOPE_LABEL: Record<CategoryScope, string> = {
  'title-body': 'title + body',
  body: 'body only',
};

interface CategoryPreferencesProps {
  categories: CategoryDef[];
  loading: boolean;
  saving: boolean;
  onSave: (next: CategoryDef[]) => void;
  /** Categories were edited since the last fetch; show the re-score prompt. */
  dirty?: boolean;
  /** Trigger a full re-score (aggregator run) against the current categories. */
  onRescore?: () => void;
  /** A re-score run is in flight. */
  rescoring?: boolean;
}

/**
 * Editable list of the candidate's job categories: the config-driven taxonomy
 * that groups postings (replaces the old hardcoded web3/ai buckets). Each
 * category has keywords (chips), an optional score weight, and a match scope.
 * Add / edit / remove persist the whole list via `onSave`; the server validates.
 */
export function CategoryPreferences({
  categories,
  loading,
  saving,
  onSave,
  dirty,
  onRescore,
  rescoring,
}: CategoryPreferencesProps) {
  const [draft, setDraft] = useState<CategoryDef[]>(categories);
  const [adding, setAdding] = useState('');
  // New-keyword input text, keyed by category id.
  const [kwInput, setKwInput] = useState<Record<string, string>>({});

  // Adopt server-validated categories whenever the loaded list changes.
  useEffect(() => {
    setDraft(categories);
  }, [categories]);

  const commit = (next: CategoryDef[]) => {
    setDraft(next);
    onSave(next);
  };

  const update = (id: string, patch: Partial<CategoryDef>) =>
    commit(draft.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const addCategory = () => {
    const cat = categoryFromLabel(adding);
    setAdding('');
    if (!cat || draft.some((c) => c.id === cat.id)) return;
    commit([...draft, cat]);
  };

  const removeCategory = (id: string) => commit(draft.filter((c) => c.id !== id));

  const addKeyword = (id: string) => {
    const kw = (kwInput[id] ?? '').trim().toLowerCase();
    setKwInput((m) => ({ ...m, [id]: '' }));
    if (!kw) return;
    const cat = draft.find((c) => c.id === id);
    if (!cat || cat.keywords.includes(kw)) return;
    update(id, { keywords: [...cat.keywords, kw] });
  };

  const removeKeyword = (id: string, kw: string) => {
    const cat = draft.find((c) => c.id === id);
    if (!cat) return;
    update(id, { keywords: cat.keywords.filter((k) => k !== kw) });
  };

  const setWeight = (id: string, raw: string) => {
    const n = Number.parseInt(raw, 10);
    update(id, { weight: Number.isFinite(n) ? Math.min(Math.max(n, 0), MAX_WEIGHT) : 0 });
  };

  return (
    <section className={styles.card}>
      <header className={styles.header}>
        <h3>Categories</h3>
        <span className={styles.muted}>Domain buckets Pupila tags and groups postings by.</span>
      </header>

      {loading ? (
        <p className={styles.muted}>Loading…</p>
      ) : (
        <>
          {draft.length === 0 && (
            <p className={styles.muted}>None yet. Add one below, or regenerate from your brief.</p>
          )}

          <ul className={styles.list}>
            {draft.map((c) => {
              const scope = c.scope ?? 'title-body';
              return (
                <li key={c.id} className={styles.item}>
                  <div className={styles.itemHead}>
                    <input
                      className={styles.labelInput}
                      value={c.label}
                      aria-label={`${c.id} label`}
                      onChange={(e) => update(c.id, { label: e.target.value })}
                    />
                    <span className={styles.id}>#{c.id}</span>
                    <span className={styles.controls}>
                      <span className={styles.control}>
                        <span className={styles.controlLabel}>Weight</span>
                        <InfoTooltip
                          ariaLabel="What is the weight?"
                          content={
                            <>
                              How much a job that matches this category gets bumped up your list. A
                              higher number ranks matching jobs higher. Leave it at{' '}
                              <strong>0</strong> to still tag and group these jobs by this category,
                              but keep their score and ranking unchanged.
                            </>
                          }
                        />
                        <input
                          type="number"
                          min={0}
                          max={MAX_WEIGHT}
                          className={styles.weightInput}
                          value={c.weight ?? 0}
                          aria-label={`${c.id} score weight`}
                          onChange={(e) => setWeight(c.id, e.target.value)}
                        />
                      </span>
                      <span className={styles.control}>
                        <span className={styles.controlLabel}>Match in</span>
                        <InfoTooltip
                          ariaLabel="What does the match scope mean?"
                          content={
                            <>
                              Where the keywords are searched. <strong>title + body</strong> checks
                              the job title and description; <strong>body only</strong> skips the
                              title, handy for stack terms you don't want matching a title in
                              passing.
                            </>
                          }
                        />
                        <span className={styles.segmented}>
                          {CATEGORY_SCOPES.map((s) => (
                            <button
                              key={s}
                              type="button"
                              className={s === scope ? styles.segmentActive : styles.segment}
                              aria-pressed={s === scope}
                              onClick={() => update(c.id, { scope: s })}
                            >
                              {SCOPE_LABEL[s]}
                            </button>
                          ))}
                        </span>
                      </span>
                    </span>
                    <button
                      type="button"
                      className={styles.remove}
                      onClick={() => removeCategory(c.id)}
                      aria-label={`Remove ${c.label}`}
                      title="Remove category"
                    >
                      ×
                    </button>
                  </div>

                  <div className={styles.chips}>
                    {c.keywords.map((kw) => (
                      <span key={kw} className={styles.chip}>
                        <span className={styles.chipLabel}>{kw}</span>
                        <button
                          type="button"
                          className={styles.chipRemove}
                          onClick={() => removeKeyword(c.id, kw)}
                          aria-label={`Remove keyword ${kw}`}
                          title="Remove"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <input
                      className={styles.kwInput}
                      placeholder="+ keyword"
                      value={kwInput[c.id] ?? ''}
                      aria-label={`Add keyword to ${c.id}`}
                      onChange={(e) => setKwInput((m) => ({ ...m, [c.id]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') addKeyword(c.id);
                      }}
                      onBlur={() => addKeyword(c.id)}
                    />
                    <InfoTooltip
                      ariaLabel="How keywords match"
                      content={
                        <>
                          Type a word or phrase. Matching is case-insensitive and matches whole
                          words, so <code>ai</code> won't match "email". Punctuation works too:{' '}
                          <code>c++</code> and <code>c#</code> match exactly, and{' '}
                          <code>node.js</code> also catches "nodejs".
                        </>
                      }
                    />
                  </div>
                </li>
              );
            })}
          </ul>

          <div className={styles.addRow}>
            <input
              className={styles.addInput}
              placeholder="Add a category (e.g. Fintech)"
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addCategory();
              }}
            />
            <button
              type="button"
              className={clsx(buttonStyles.secondary, buttonStyles.sm)}
              disabled={!adding.trim()}
              onClick={addCategory}
            >
              Add category
            </button>
            {saving && <span className={styles.muted}>Saving…</span>}
          </div>

          <p className={styles.hint}>
            Add keywords as chips; a job is tagged with every category it matches. Regenerate from
            your brief (Settings → Scoring profile) to rebuild the whole taxonomy automatically.
          </p>

          {dirty && onRescore && (
            <div className={styles.rescore}>
              <span className={styles.muted}>
                Categories changed. Re-score jobs to apply (re-runs the aggregator).
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
