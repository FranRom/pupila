import clsx from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, formatError } from './lib/api/index.ts';
import styles from './Profile.module.css';
import bannerStyles from './styles/Banner.module.css';
import buttonStyles from './styles/Button.module.css';

type CvFormat = 'pdf' | 'docx' | 'md' | 'txt';

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
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const summarizeFile = useCallback(async (file: File) => {
    const format = detectFormatFromName(file.name);
    if (!format) {
      setError(`Unsupported file: ${file.name}. Use .pdf, .docx, .md, or .txt.`);
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(`Parsing ${file.name} and running LLM CLI…`);
    const data =
      format === 'pdf' || format === 'docx' ? await fileToBase64(file) : await fileToText(file);
    const r = await api.cv.upload({ format, data });
    setBusy(false);
    if (!r.ok) {
      setError(`CV summarization failed: ${formatError(r.error)}`);
      setInfo(null);
      return;
    }
    setBody(r.value.body);
    setDraft(r.value.body);
    setInfo(`✓ Brief regenerated from ${file.name}.`);
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
              onClick={() => setPasteMode((m) => !m)}
            >
              {pasteMode ? 'Cancel paste' : 'Paste text'}
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
