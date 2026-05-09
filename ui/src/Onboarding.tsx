import { useCallback, useEffect, useMemo, useState } from 'react';

// First-run wizard. Three steps:
//   1. Pick the LLM CLI provider (probes /api/llm-detect for ✓/✗).
//   2. Drop your CV (PDF/DOCX/MD/TXT) — the LLM rewrites it into a brief.
//   3. Preview the generated brief, confirm, land on Jobs.
//
// Triggered by App.tsx when /api/preferences returns onboardedAt: null.
// Once the user finishes step 3, /api/preferences is POSTed with the
// chosen provider + today's date as `onboardedAt`. The wizard never
// re-triggers after that, even if the brief gets removed (the regular
// Profile-tab empty state handles re-setup).

type Provider = 'claude' | 'codex' | 'gemini' | 'opencode';
type ProviderChoice = Provider | 'auto';

const PROVIDERS: readonly Provider[] = ['claude', 'codex', 'gemini', 'opencode'];

interface DetectResponse {
  available: Record<Provider, boolean>;
}

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
  const CHUNK = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  }
  return btoa(parts.join(''));
}

interface OnboardingProps {
  onComplete: () => void;
}

type Step = 'provider' | 'cv' | 'preview';

export function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState<Step>('provider');
  const [available, setAvailable] = useState<Record<Provider, boolean> | null>(null);
  const [provider, setProvider] = useState<ProviderChoice>('auto');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [briefDraft, setBriefDraft] = useState<string>('');
  const [generatedBrief, setGeneratedBrief] = useState<string>('');

  // Load installed-CLI status on mount.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/llm-detect')
      .then((r) => (r.ok ? (r.json() as Promise<DetectResponse>) : Promise.reject(r.status)))
      .then((data) => {
        if (cancelled) return;
        setAvailable(data.available);
        // Pre-select the first installed CLI as a sensible default.
        const firstInstalled = PROVIDERS.find((p) => data.available[p]);
        if (firstInstalled) setProvider(firstInstalled);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(`Could not probe LLM CLIs: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const anyAvailable = useMemo(() => {
    if (!available) return false;
    return PROVIDERS.some((p) => available[p]);
  }, [available]);

  const uploadCv = useCallback(async (file: File) => {
    const format = detectFormatFromName(file.name);
    if (!format) {
      setError(`Unsupported file: ${file.name}. Use .pdf, .docx, .md, or .txt.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data =
        format === 'pdf' || format === 'docx' ? await fileToBase64(file) : await file.text();
      const res = await fetch('/api/cv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format, data }),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }
      const out = (await res.json()) as { ok: boolean; body: string };
      setGeneratedBrief(out.body);
      setBriefDraft(out.body);
      setStep('preview');
    } catch (err) {
      setError(`CV summarization failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  const finish = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // If the user edited the preview, save those edits first.
      if (briefDraft.trim() !== generatedBrief.trim()) {
        const briefRes = await fetch('/api/brief', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ markdown: briefDraft }),
        });
        if (!briefRes.ok) throw new Error(`brief save: HTTP ${briefRes.status}`);
      }
      const prefRes = await fetch('/api/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      if (!prefRes.ok) {
        const errBody = (await prefRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error ?? `preferences save: HTTP ${prefRes.status}`);
      }
      onComplete();
    } catch (err) {
      setError(`Could not finish onboarding: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [briefDraft, generatedBrief, provider, onComplete]);

  return (
    <div className="onboarding">
      <header className="onboarding-header">
        <AsciiHero />
        <p className="subtitle">
          A 30-second setup. Pick your LLM CLI, drop your CV, confirm the generated brief.
        </p>
        <ol className="onboarding-progress">
          <li className={step === 'provider' ? 'current' : 'done'}>1. LLM CLI</li>
          <li className={step === 'cv' ? 'current' : step === 'preview' ? 'done' : ''}>
            2. CV upload
          </li>
          <li className={step === 'preview' ? 'current' : ''}>3. Confirm</li>
        </ol>
      </header>

      {error && (
        <div className="api-error" role="alert">
          {error}{' '}
          <button type="button" onClick={() => setError(null)}>
            dismiss
          </button>
        </div>
      )}

      {step === 'provider' && (
        <section className="onboarding-step">
          <h2>Pick your LLM CLI</h2>
          <p>
            job-hunt shells out to a local LLM CLI (no API keys, uses your existing subscription)
            for the CV summary, per-job AI review, and AI Apply. Pick whichever you have installed.
          </p>
          {!available ? (
            <p className="placeholder">Probing installed CLIs…</p>
          ) : (
            <ul className="provider-list">
              <li>
                <label>
                  <input
                    type="radio"
                    name="provider"
                    value="auto"
                    checked={provider === 'auto'}
                    onChange={() => setProvider('auto')}
                  />
                  <strong>Auto-detect</strong>
                  <span className="muted">
                    — picks the first installed in claude → codex → gemini → opencode order
                  </span>
                </label>
              </li>
              {PROVIDERS.map((p) => (
                <li key={p}>
                  <label>
                    <input
                      type="radio"
                      name="provider"
                      value={p}
                      checked={provider === p}
                      onChange={() => setProvider(p)}
                      disabled={!available[p]}
                    />
                    <strong>{p}</strong>
                    <span className={available[p] ? 'available' : 'unavailable'}>
                      {available[p] ? '✓ installed' : '✗ not on PATH'}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {!anyAvailable && available && (
            <p className="warn">
              No supported CLI found on PATH. Install one before continuing — for example,{' '}
              <a
                href="https://docs.claude.com/en/docs/claude-code/quickstart"
                target="_blank"
                rel="noopener noreferrer"
              >
                Claude Code
              </a>
              .
            </p>
          )}
          <div className="onboarding-actions">
            <button type="button" disabled={!anyAvailable || busy} onClick={() => setStep('cv')}>
              Next: upload CV →
            </button>
          </div>
        </section>
      )}

      {step === 'cv' && (
        <section className="onboarding-step">
          <h2>Upload your CV</h2>
          <p>
            We'll send the contents to your local <code>{provider}</code> CLI to generate a short
            candidate brief. The original file stays on disk at <code>config/cv.&lt;ext&gt;</code>{' '}
            (gitignored) so AI Apply can re-attach it later.
          </p>
          <CvDropZone busy={busy} onFile={uploadCv} />
          <div className="onboarding-actions">
            <button type="button" disabled={busy} onClick={() => setStep('provider')}>
              ← Back
            </button>
          </div>
        </section>
      )}

      {step === 'preview' && (
        <section className="onboarding-step">
          <h2>Confirm your brief</h2>
          <p>
            Edit anything that's off — this is what the per-job AI review and AI Apply will see.
          </p>
          <textarea
            className="brief-textarea"
            value={briefDraft}
            onChange={(e) => setBriefDraft(e.target.value)}
            rows={14}
            disabled={busy}
          />
          <div className="onboarding-actions">
            <button type="button" disabled={busy} onClick={() => setStep('cv')}>
              ← Re-upload CV
            </button>
            <button type="button" disabled={busy} onClick={() => void finish()}>
              {busy ? 'Saving…' : 'Looks good →'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

// Hand-laid ASCII block reading "job hunt" — figlet-style "Standard" font,
// trimmed and aligned. Each line types itself out with a staggered delay
// (CSS keyframes in styles.css), and a blinking cursor lands at the end of
// the tagline. Falls back to instant render under prefers-reduced-motion.
const ASCII_HERO_LINES: readonly string[] = [
  '   _       _        _                 _   ',
  '  (_) ___ | |__    | |__  _   _ _ __ | |_ ',
  "  | |/ _ \\| '_ \\   | '_ \\| | | | '_ \\| __|",
  '  | | (_) | |_) |  | | | | |_| | | | | |_ ',
  ' _/ |\\___/|_.__/   |_| |_|\\__,_|_| |_|\\__|',
  '|__/                                      ',
];

function AsciiHero() {
  return (
    <div className="ascii-hero" role="img" aria-label="job-hunt">
      {ASCII_HERO_LINES.map((line) => (
        <span key={line} className="ascii-hero-line">
          {line}
        </span>
      ))}
      <span className="ascii-hero-tag">
        &gt; hunting for your next role across 13 sources
        <span className="ascii-hero-cursor" />
      </span>
    </div>
  );
}

interface CvDropZoneProps {
  busy: boolean;
  onFile: (f: File) => void;
}

function CvDropZone({ busy, onFile }: CvDropZoneProps) {
  const [dragActive, setDragActive] = useState(false);
  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files?.[0];
      if (file) onFile(file);
    },
    [onFile],
  );
  return (
    <section
      className={`cv-drop ${dragActive ? 'cv-drop-active' : ''} ${busy ? 'cv-drop-busy' : ''}`}
      aria-label="CV upload drop zone"
      onDragOver={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={onDrop}
    >
      <div className="cv-drop-row">
        <div className="cv-drop-text">
          <strong>Drop your CV here</strong> (.pdf / .docx / .md / .txt). The LLM CLI runs locally —
          no upload to any server.
        </div>
        <label className="cv-drop-actions">
          <input
            type="file"
            accept=".pdf,.docx,.md,.markdown,.txt"
            style={{ display: 'none' }}
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = '';
            }}
          />
          <span className="onboarding-button">{busy ? 'Working…' : 'Choose file'}</span>
        </label>
      </div>
    </section>
  );
}
