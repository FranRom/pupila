import { useCallback, useEffect, useRef, useState } from 'react';

type CvFormat = 'pdf' | 'docx' | 'md' | 'txt';

interface BriefGetResponse {
  body: string | null;
}

interface BriefMutateResponse {
  ok: boolean;
  body: string;
}

interface ApiError {
  error: string;
}

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
    let cancelled = false;
    fetch('/api/brief')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<BriefGetResponse>;
      })
      .then((data) => {
        if (cancelled) return;
        const next = data.body ?? '';
        setBody(next);
        setDraft(next);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          `Could not load brief: ${err instanceof Error ? err.message : String(err)}. The /api/brief endpoint only runs under \`pnpm run ui\`.`,
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
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
    try {
      const data =
        format === 'pdf' || format === 'docx' ? await fileToBase64(file) : await fileToText(file);
      const res = await fetch('/api/cv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format, data }),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as ApiError;
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }
      const out = (await res.json()) as BriefMutateResponse;
      setBody(out.body);
      setDraft(out.body);
      setInfo(`✓ Brief regenerated from ${file.name}.`);
    } catch (err) {
      setError(`CV summarization failed: ${err instanceof Error ? err.message : String(err)}`);
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
    try {
      const res = await fetch('/api/cv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'txt', data: pasteText }),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as ApiError;
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }
      const out = (await res.json()) as BriefMutateResponse;
      setBody(out.body);
      setDraft(out.body);
      setPasteText('');
      setPasteMode(false);
      setInfo('✓ Brief regenerated from pasted text.');
    } catch (err) {
      setError(`CV summarization failed: ${err instanceof Error ? err.message : String(err)}`);
      setInfo(null);
    } finally {
      setBusy(false);
    }
  }, [pasteText]);

  const saveDraft = useCallback(async () => {
    if (draft.trim() === body.trim()) {
      setInfo('No changes to save.');
      return;
    }
    setBusy(true);
    setError(null);
    setInfo('Saving…');
    try {
      const res = await fetch('/api/brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: draft }),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as ApiError;
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }
      const out = (await res.json()) as BriefMutateResponse;
      setBody(out.body);
      setDraft(out.body);
      setInfo('✓ Saved.');
    } catch (err) {
      setError(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
      setInfo(null);
    } finally {
      setBusy(false);
    }
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
      <div className="profile">
        <p className="placeholder">Loading…</p>
      </div>
    );
  }

  const dirty = draft.trim() !== body.trim();

  return (
    <div className="profile">
      <header className="profile-header">
        <h2>Candidate brief</h2>
        <p className="subtitle">
          Used by <code>pnpm run ai-review</code> to score every job posting against your profile.
          Drop your CV here to regenerate, or hand-edit the markdown below.
        </p>
      </header>

      {error && (
        <div className="api-error" role="alert">
          {error}{' '}
          <button type="button" onClick={() => setError(null)}>
            dismiss
          </button>
        </div>
      )}
      {info && !error && (
        <div className="api-info" role="status">
          {info}
        </div>
      )}

      <section
        className={`cv-drop ${dragActive ? 'cv-drop-active' : ''} ${busy ? 'cv-drop-busy' : ''}`}
        aria-label="CV upload drop zone"
        // biome-ignore lint/a11y/noStaticElementInteractions: drop targets are
        // inherently mouse-only; keyboard users have the "Choose file" button.
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
      >
        <div className="cv-drop-row">
          <div className="cv-drop-text">
            <strong>Drop a CV file</strong> (.pdf / .docx / .md / .txt) to regenerate the brief via
            your local LLM CLI (claude / codex / gemini / opencode).
          </div>
          <div className="cv-drop-actions">
            <button type="button" disabled={busy} onClick={() => fileInputRef.current?.click()}>
              Choose file
            </button>
            <button type="button" disabled={busy} onClick={() => setPasteMode((m) => !m)}>
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
        <section className="cv-paste">
          <textarea
            placeholder="Paste your CV here as text or markdown…"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={12}
          />
          <div className="cv-paste-actions">
            <button
              type="button"
              disabled={busy || !pasteText.trim()}
              onClick={() => void summarizePasted()}
            >
              Summarize via LLM
            </button>
            <span className="muted">{pasteText.length} chars</span>
          </div>
        </section>
      )}

      <section className="brief-editor">
        <header className="brief-editor-header">
          <h3>Current brief</h3>
          <span className="muted">
            {body ? `${body.length} chars` : 'no brief yet'}
            {dirty && <span className="dirty-tag"> · unsaved</span>}
          </span>
        </header>
        {body || dirty ? (
          <textarea
            className="brief-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={14}
            disabled={busy}
            placeholder="Hand-write your brief here, or drop a CV file above."
          />
        ) : (
          <p className="placeholder">
            No brief yet. Drop a CV above, paste text, or write directly into the textarea below.
          </p>
        )}
        {!body && !dirty && (
          <textarea
            className="brief-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={14}
            placeholder="Three short paragraphs: who you are, what you want, what to avoid."
          />
        )}
        <div className="brief-actions">
          <button type="button" disabled={busy || !dirty} onClick={() => void saveDraft()}>
            Save
          </button>
          <button
            type="button"
            disabled={busy || !dirty}
            onClick={() => setDraft(body)}
            className="reset"
          >
            Discard changes
          </button>
        </div>
      </section>
    </div>
  );
}
