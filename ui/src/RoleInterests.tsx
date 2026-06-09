import clsx from 'clsx';
import { useEffect, useState } from 'react';
import styles from './RoleInterests.module.css';
import buttonStyles from './styles/Button.module.css';
import type { RoleInterest } from './types.ts';

function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Build a RoleInterest from a free-text label. titleMatch is the label as one
// literal phrase (regex-escaped, lowercased) — the chip text IS what we match
// against job titles. Brief regeneration produces richer multi-fragment
// matching; manual chips stay simple + predictable. Any existing bodyMatch is
// preserved across a rename.
function roleFromLabel(label: string, existing?: RoleInterest): RoleInterest | null {
  const trimmed = label.trim();
  const id = slugify(trimmed);
  if (!trimmed || !id) return null;
  const role: RoleInterest = {
    id,
    label: trimmed,
    titleMatch: [escapeRegExp(trimmed.toLowerCase())],
  };
  if (existing?.bodyMatch?.length) role.bodyMatch = existing.bodyMatch;
  return role;
}

interface RoleInterestsProps {
  roles: RoleInterest[];
  loading: boolean;
  saving: boolean;
  onSave: (roles: RoleInterest[]) => void;
}

/**
 * Editable chip list of the candidate's target roles. Add / rename / remove
 * persist the whole list via `onSave`. The chip text doubles as the title-match
 * phrase (see roleFromLabel).
 */
export function RoleInterests({ roles, loading, saving, onSave }: RoleInterestsProps) {
  const [draft, setDraft] = useState<RoleInterest[]>(roles);
  const [adding, setAdding] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');

  // Adopt server-validated roles whenever the loaded list changes.
  useEffect(() => {
    setDraft(roles);
  }, [roles]);

  const commit = (next: RoleInterest[]) => {
    setDraft(next);
    onSave(next);
  };

  const addRole = () => {
    const role = roleFromLabel(adding);
    setAdding('');
    if (!role || draft.some((r) => r.id === role.id)) return;
    commit([...draft, role]);
  };

  const removeRole = (id: string) => commit(draft.filter((r) => r.id !== id));

  const beginEdit = (r: RoleInterest) => {
    setEditingId(r.id);
    setEditingLabel(r.label);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingLabel('');
  };

  const saveEdit = () => {
    if (editingId === null) return;
    const existing = draft.find((r) => r.id === editingId);
    const updated = roleFromLabel(editingLabel, existing);
    cancelEdit();
    if (!updated) return;
    // Skip if a different role already owns the new id (rename collision).
    if (draft.some((r) => r.id === updated.id && r.id !== editingId)) return;
    commit(draft.map((r) => (r.id === editingId ? updated : r)));
  };

  return (
    <section className={styles.card}>
      <header className={styles.header}>
        <h3>Role interests</h3>
        <span className={styles.muted}>Target job titles Pupila matches postings against.</span>
      </header>

      {loading ? (
        <p className={styles.muted}>Loading…</p>
      ) : (
        <>
          <div className={styles.chips}>
            {draft.length === 0 && (
              <span className={styles.muted}>
                None yet — add one below, or regenerate from your brief.
              </span>
            )}
            {draft.map((r) =>
              editingId === r.id ? (
                <input
                  // biome-ignore lint/a11y/noAutofocus: inline rename — focus the field the user just opened
                  autoFocus
                  key={r.id}
                  className={styles.editInput}
                  value={editingLabel}
                  onChange={(e) => setEditingLabel(e.target.value)}
                  onBlur={saveEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveEdit();
                    if (e.key === 'Escape') cancelEdit();
                  }}
                />
              ) : (
                <span key={r.id} className={styles.chip}>
                  <button
                    type="button"
                    className={styles.chipLabel}
                    onClick={() => beginEdit(r)}
                    title="Rename"
                  >
                    {r.label}
                  </button>
                  <button
                    type="button"
                    className={styles.chipRemove}
                    onClick={() => removeRole(r.id)}
                    aria-label={`Remove ${r.label}`}
                    title="Remove"
                  >
                    ×
                  </button>
                </span>
              ),
            )}
          </div>

          <div className={styles.addRow}>
            <input
              className={styles.addInput}
              placeholder="Add a role (e.g. Product Engineer)"
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addRole();
              }}
            />
            <button
              type="button"
              className={clsx(buttonStyles.secondary, buttonStyles.sm)}
              disabled={!adding.trim()}
              onClick={addRole}
            >
              Add role
            </button>
            {saving && <span className={styles.muted}>Saving…</span>}
          </div>

          <p className={styles.hint}>
            Editing here changes what counts as a match. Regenerate from your brief (Settings →
            Scoring profile) for richer keyword matching.
          </p>
        </>
      )}
    </section>
  );
}
