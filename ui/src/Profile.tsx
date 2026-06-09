import clsx from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, formatError } from './lib/api/index.ts';
import { useRoles } from './lib/hooks/useRoles.ts';
import styles from './Profile.module.css';
import { RoleInterests } from './RoleInterests.tsx';
import bannerStyles from './styles/Banner.module.css';
import buttonStyles from './styles/Button.module.css';

type CvFormat = 'pdf' | 'docx' | 'md' | 'txt';
// Mirrors BriefSource in src/lib/brief-prompt.ts. 'linkedin' = a profile
// exported via "Save to PDF"; only switches the LLM prompt framing.
type BriefSource = 'cv' | 'linkedin';

const FORMAT_BY_EXT: Record<string, CvFormat> = {
  pdf: 'pdf',
  docx: 'docx',
  md: 'md',
  markdown: 'md',
  txt: 'txt',
};

function detectFormatFromName(name: string): CvFormat | null {
  const idx = name.lastIndexOf('.');
  if (idx === -1) return null;
  const ext = name.slice(idx + 1).toLowerCase();
  return FORMAT_BY_EXT[ext] ?? null;
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // Avoid call-stack issues for large files by chunking.
  const CHUNK = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  }
  return btoa(parts.join(''));
}

async function fileToText(file: File): Promise<string> {
  return file.text();
}

export function Profile() {
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState<string>('');
  const [draft, setDraft] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [linkedinMode, setLinkedinMode] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const linkedinInputRef = useRef<HTMLInputElement>(null);
  const onRolesError = useCallback((msg: string) => setError(msg), []);
  const {
    roles,
    loading: rolesLoading,
    saving: rolesSaving,
    save: saveRoles,
  } = useRoles({
    onError: onRolesError,
  });

  useEffect(() => {
    const ctrl = new AbortController();
    const load = async () => {
      const r = await api.brief.get({ signal: ctrl.signal });
      if (!r.ok) {
        if (r.error.kind === 'abort') return;
        setError(
          `Could not load brief: ${formatError(r.error)}. The /api/brief endpoint only runs under \`pnpm run ui\`.`,
        );
        setLoading(false);
        return;
      }
      const next = r.value.body ?? '';
      setBody(next);
      setDraft(next);
      setLoading(false);
    };
    void load();
    return () => ctrl.abort();
  }, []);

  const summarizeFile = useCallback(async (file: File, source: BriefSource = 'cv') => {
    const format = detectFormatFromName(file.name);
    if (!format) {
      setError(`Unsupported file: ${file.name}. Use .pdf, .docx, .md, or .txt.`);
      return;
    }
    const label = source === 'linkedin' ? 'LinkedIn profile' : file.name;
    setBusy(true);
    setError(null);
    setInfo(`Parsing ${label} and running LLM CLI…`);
    // try/finally so a throw in fileToBase64/fileToText (corrupt file, browser
    // security error) can't leave `busy` stuck and disable the whole tab.
    try {
      const data =
        format === 'pdf' || format === 'docx' ? await fileToBase64(file) : await fileToText(file);
      const r = await api.cv.upload({ format, data, source });
      if (!r.ok) {
        setError(`Brief generation failed: ${formatError(r.error)}`);
        setInfo(null);
        return;
      }
      setBody(r.value.body);
      setDraft(r.value.body);
      setLinkedinMode(false);
      setInfo(`✓ Brief regenerated from ${label}.`);
    } catch (err) {
      setError(`Brief generation failed: ${err instanceof Error ? err.message : String(err)}`);
      setInfo(null);
    } finally {
      setBusy(false);
    }
  }, []);

  const summarizePasted = useCallback(async () => {
    if (!pasteText.trim()) return;
    setBusy(true);
    setError(null);
    setInfo('Running LLM CLI on pasted text…');
    const r = await api.cv.upload({ format: 'txt', data: pasteText });
    setBusy(false);
    if (!r.ok) {
      setError(`CV summarization failed: ${formatError(r.error)}`);
      setInfo(null);
      return;
    }
    setBody(r.value.body);
    setDraft(r.value.body);
    setPasteText('');
    setPasteMode(false);
    setInfo('✓ Brief regenerated from pasted text.');
  }, [pasteText]);

  const saveDraft = useCallback(async () => {
    if (draft.trim() === body.trim()) {
      setInfo('No changes to save.');
      return;
    }
    setBusy(true);
    setError(null);
    setInfo('Saving…');
    const r = await api.brief.set(draft);
    setBusy(false);
    if (!r.ok) {
      setError(`Save failed: ${formatError(r.error)}`);
      setInfo(null);
      return;
    }
    setBody(r.value.body);
    setDraft(r.value.body);
    setInfo('✓ Saved.');
  }, [draft, body]);

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void summarizeFile(file);
  }

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void summarizeFile(file);
    e.target.value = '';
  }

  function onLinkedinPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void summarizeFile(file, 'linkedin');
    e.target.value = '';
  }

  if (loading) {
    return (
      <div className={styles.tab}>
        <p className={styles.placeholder}>Loading…</p>
      </div>
    );
  }

  const dirty = draft.trim() !== body.trim();

  return (
    <div className={styles.tab}>
      <header className={styles.header}>
        <h2>Candidate brief</h2>
        <p className={styles.subtitle}>
          Used by <code>pnpm run ai-review</code> to score every job posting against your profile.
          Drop your CV here to regenerate, or hand-edit the markdown below.
        </p>
      </header>

      {error && (
        <div className={bannerStyles.error} role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            dismiss
          </button>
        </div>
      )}
      {info && !error && (
        <div className={styles.info} role="status">
          {info}
        </div>
      )}

      <section
        className={clsx(
          dragActive ? styles.cvDropActive : styles.cvDrop,
          busy && styles.cvDropBusy,
        )}
        aria-label="CV upload drop zone"
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
      >
        <div className={styles.cvDropRow}>
          <div className={styles.cvDropText}>
            <strong>Drop a CV file</strong> (.pdf / .docx / .md / .txt) to regenerate the brief via
            your local LLM CLI (claude / codex / gemini / opencode).
          </div>
          <div className={styles.cvDropActions}>
            <button
              type="button"
              className={clsx(buttonStyles.secondary, buttonStyles.sm)}
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              Choose file
            </button>
            <button
              type="button"
              className={clsx(buttonStyles.primary, buttonStyles.sm)}
              disabled={busy}
              onClick={() => {
                // Mutually exclusive with the LinkedIn panel — only one open at a time.
                setLinkedinMode(false);
                setPasteMode((m) => !m);
              }}
            >
              {pasteMode ? 'Cancel paste' : 'Paste text'}
            </button>
            <button
              type="button"
              className={clsx(buttonStyles.primary, buttonStyles.sm)}
              disabled={busy}
              onClick={() => {
                setPasteMode(false);
                setLinkedinMode((m) => !m);
              }}
            >
              {linkedinMode ? 'Cancel LinkedIn' : 'From LinkedIn'}
            </button>
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.md,.markdown,.txt"
          style={{ display: 'none' }}
          onChange={onFilePicked}
        />
      </section>

      {linkedinMode && (
        <section className={styles.cvPaste}>
          <p className={styles.muted}>
            No recent CV? Export your LinkedIn profile as a PDF (<strong>More</strong> →{' '}
            <strong>Save to PDF</strong> on your profile) and upload it here — we'll build the brief
            from that.
          </p>
          <div className={styles.cvPasteActions}>
            <button
              type="button"
              className={clsx(buttonStyles.secondary, buttonStyles.sm)}
              disabled={busy}
              onClick={() => linkedinInputRef.current?.click()}
            >
              Upload LinkedIn PDF
            </button>
          </div>
          <input
            ref={linkedinInputRef}
            type="file"
            accept=".pdf"
            style={{ display: 'none' }}
            onChange={onLinkedinPicked}
          />
        </section>
      )}

      {pasteMode && (
        <section className={styles.cvPaste}>
          <textarea
            placeholder="Paste your CV here as text or markdown…"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={12}
          />
          <div className={styles.cvPasteActions}>
            <button
              type="button"
              className={clsx(buttonStyles.secondary, buttonStyles.sm)}
              disabled={busy || !pasteText.trim()}
              onClick={() => void summarizePasted()}
            >
              Summarize via LLM
            </button>
            <span className={styles.muted}>{pasteText.length} chars</span>
          </div>
        </section>
      )}

      <RoleInterests roles={roles} loading={rolesLoading} saving={rolesSaving} onSave={saveRoles} />

      <section className={styles.briefEditor}>
        <header className={styles.briefEditorHeader}>
          <h3>Current brief</h3>
          <span className={styles.muted}>
            {body ? `${body.length} chars` : 'no brief yet'}
            {dirty && <span className={styles.dirtyTag}> · unsaved</span>}
          </span>
        </header>
        {body || dirty ? (
          <textarea
            className={styles.briefTextarea}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={14}
            disabled={busy}
            placeholder="Hand-write your brief here, or drop a CV file above."
          />
        ) : (
          <p className={styles.placeholder}>
            No brief yet. Drop a CV above, paste text, or write directly into the textarea below.
          </p>
        )}
        {!body && !dirty && (
          <textarea
            className={styles.briefTextarea}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={14}
            placeholder="Three short paragraphs: who you are, what you want, what to avoid."
          />
        )}
        <div className={styles.briefActions}>
          <button
            type="button"
            className={clsx(buttonStyles.secondary, buttonStyles.sm)}
            disabled={busy || !dirty}
            onClick={() => void saveDraft()}
          >
            Save
          </button>
          <button
            type="button"
            disabled={busy || !dirty}
            onClick={() => setDraft(body)}
            className={clsx(buttonStyles.primary, buttonStyles.sm)}
          >
            Discard changes
          </button>
        </div>
      </section>
    </div>
  );
}
