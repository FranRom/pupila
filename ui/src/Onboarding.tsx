import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, formatError } from './lib/api/index.ts';
import { useLlmStream } from './lib/use-llm-stream.ts';
import styles from './Onboarding.module.css';
import { StreamingPanel } from './StreamingPanel.tsx';
import bannerStyles from './styles/Banner.module.css';
import buttonStyles from './styles/Button.module.css';
import spinnerStyles from './styles/Spinner.module.css';

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
  // Separate `tuning` state so the button label can show what's actually
  // happening when we block on /api/profile-generate (which can take 10–20s).
  // Without this distinction the user sees a generic "Saving…" for too long.
  const [tuning, setTuning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [briefDraft, setBriefDraft] = useState<string>('');
  const [generatedBrief, setGeneratedBrief] = useState<string>('');

  // One hook per LLM phase: CV summarization + profile tuning. Each one
  // owns its own stream/status/stage/elapsed/error state internally.
  const cv = useLlmStream<{ body?: string }>({ url: '/api/cv' });
  const tune = useLlmStream<{
    weightsChanged?: string[];
    keywordsChanged?: string[];
  }>({ url: '/api/profile-generate' });

  // Load installed-CLI status on mount.
  useEffect(() => {
    const ctrl = new AbortController();
    const load = async () => {
      const r = await api.llm.detect({ signal: ctrl.signal });
      if (!r.ok) {
        if (r.error.kind === 'abort') return;
        setError(`Could not probe LLM CLIs: ${formatError(r.error)}`);
        return;
      }
      setAvailable(r.value.available);
      // Pre-select the first installed CLI as a sensible default.
      const firstInstalled = PROVIDERS.find((p) => r.value.available[p]);
      if (firstInstalled) setProvider(firstInstalled);
    };
    void load();
    return () => ctrl.abort();
  }, []);

  const anyAvailable = useMemo(() => {
    if (!available) return false;
    return PROVIDERS.some((p) => available[p]);
  }, [available]);

  const uploadCv = useCallback(
    async (file: File) => {
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
        const done = await cv.start({ format, data });
        if (!done?.body) {
          // hook already set its own error+status; mirror it into the
          // wizard-level error banner so the user sees a single message.
          if (cv.error) setError(`CV summarization failed: ${cv.error}`);
          return;
        }
        setGeneratedBrief(done.body);
        setBriefDraft(done.body);
        setStep('preview');
      } finally {
        setBusy(false);
      }
    },
    [cv],
  );

  const finish = useCallback(async () => {
    setBusy(true);
    setError(null);
    // If the user edited the preview, save those edits first.
    if (briefDraft.trim() !== generatedBrief.trim()) {
      const briefR = await api.brief.set(briefDraft);
      if (!briefR.ok) {
        setError(`Could not finish onboarding: brief save: ${formatError(briefR.error)}`);
        setBusy(false);
        return;
      }
    }
    const prefR = await api.preferences.set({ provider });
    if (!prefR.ok) {
      setError(`Could not finish onboarding: preferences save: ${formatError(prefR.error)}`);
      setBusy(false);
      return;
    }
    // Block onboarding handoff on profile-generate so the auto-fetch
    // that fires next picks up the freshly-tuned profile.json. Earlier
    // versions did this fire-and-forget, which caused the first jobs.json
    // to score against the empty profile (max ~45 from seniority alone)
    // even though the brief had been generated.
    // Errors here don't block the handoff — Settings → Scoring profile
    // has a manual retry button.
    setTuning(true);
    const tuneDone = await tune.start({ provider: provider === 'auto' ? null : provider });
    if (!tuneDone && tune.error) {
      console.warn('[onboarding] profile generation failed; continuing anyway:', tune.error);
    }
    setTuning(false);
    setBusy(false);
    onComplete();
  }, [briefDraft, generatedBrief, provider, onComplete, tune]);

  return (
    <div className={styles.wizard}>
      <header className={styles.header}>
        <AsciiHero />
        <p className={styles.subtitle}>
          A 30-second setup. Pick your LLM CLI, drop your CV, confirm the generated brief.
        </p>
        <ol className={styles.progress}>
          <li className={step === 'provider' ? styles.progressCurrent : styles.progressDone}>
            1. LLM CLI
          </li>
          <li
            className={
              step === 'cv'
                ? styles.progressCurrent
                : step === 'preview'
                  ? styles.progressDone
                  : undefined
            }
          >
            2. CV upload
          </li>
          <li className={step === 'preview' ? styles.progressCurrent : undefined}>3. Confirm</li>
        </ol>
      </header>

      {error && (
        <div className={bannerStyles.error} role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            dismiss
          </button>
        </div>
      )}

      {step === 'provider' && (
        <section className={styles.step}>
          <h2>Pick your LLM CLI</h2>
          <p>
            Pupila shells out to a local LLM CLI (no API keys, uses your existing subscription) for
            the CV summary, per-job AI review, and AI Apply. Pick whichever you have installed.
          </p>
          {!available ? (
            <p className={styles.placeholder}>Probing installed CLIs…</p>
          ) : (
            <ul className={styles.providerList}>
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
                  <span className={styles.muted}>
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
                    <span className={available[p] ? styles.available : styles.unavailable}>
                      {available[p] ? '✓ installed' : '✗ not on PATH'}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {!anyAvailable && available && (
            <p className={styles.warn}>
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
          <div className={styles.actions}>
            <button
              type="button"
              className={buttonStyles.secondary}
              disabled={!anyAvailable || busy}
              onClick={() => setStep('cv')}
            >
              Next: upload CV →
            </button>
          </div>
        </section>
      )}

      {step === 'cv' && (
        <section className={styles.step}>
          <h2>Upload your CV</h2>
          <p>
            We'll send the contents to your local <code>{provider}</code> CLI to generate a short
            candidate brief. The original file stays on disk at <code>config/cv.&lt;ext&gt;</code>{' '}
            (gitignored) so AI Apply can re-attach it later.
          </p>
          <CvDropZone busy={busy} onFile={uploadCv} />
          <StreamingPanel
            title={
              cv.stage === 'parsing-cv'
                ? 'Reading your CV…'
                : cv.stage === 'calling-llm'
                  ? 'Generating brief…'
                  : 'Working…'
            }
            stream={cv.stream}
            status={cv.status}
            elapsedMs={cv.elapsedMs}
            provider={provider === 'auto' ? null : provider}
            error={cv.status === 'error' ? error : null}
          />
          <div className={styles.actions}>
            <button
              type="button"
              className={buttonStyles.primary}
              disabled={busy}
              onClick={() => setStep('provider')}
            >
              ← Back
            </button>
          </div>
        </section>
      )}

      {step === 'preview' && (
        <section className={styles.step}>
          <h2>Confirm your brief</h2>
          <p>
            Edit anything that's off — this is what the per-job AI review and AI Apply will see.
          </p>
          <textarea
            className={styles.briefTextarea}
            value={briefDraft}
            onChange={(e) => setBriefDraft(e.target.value)}
            rows={14}
            disabled={busy}
          />
          <StreamingPanel
            title="Tuning scoring profile from your brief…"
            stream={tune.stream}
            status={tune.status}
            elapsedMs={tune.elapsedMs}
            provider={provider === 'auto' ? null : provider}
          />
          <div className={styles.actions}>
            <button
              type="button"
              className={buttonStyles.primary}
              disabled={busy}
              onClick={() => setStep('cv')}
            >
              ← Re-upload CV
            </button>
            <button
              type="button"
              className={buttonStyles.secondary}
              disabled={busy}
              onClick={() => void finish()}
            >
              {busy && <span className={spinnerStyles.spinner} aria-hidden />}
              {tuning
                ? 'Tuning scoring profile from your brief…'
                : busy
                  ? 'Saving…'
                  : 'Looks good →'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

// Hand-laid ASCII block reading "pupila" — figlet-style "Standard" font,
// trimmed and aligned. Each line types itself out with a staggered delay
// (CSS keyframes in Onboarding.module.css), and a blinking cursor lands at
// the end of the tagline. Falls back to instant render under
// prefers-reduced-motion.
const ASCII_HERO_LINES: readonly string[] = [
  '                 _ _       ',
  ' _ __  _   _ _ __(_) | __ _ ',
  "| '_ \\| | | | '_ \\| | |/ _` |",
  '| |_) | |_| | |_) | | | (_| |',
  '| .__/ \\__,_| .__/|_|_|\\__,_|',
  '|_|         |_|             ',
];

function AsciiHero() {
  return (
    <div className={styles.asciiHero} role="img" aria-label="pupila">
      {ASCII_HERO_LINES.map((line) => (
        <span key={line} className={styles.asciiLine}>
          {line}
        </span>
      ))}
      <span className={styles.asciiTag}>
        &gt; watching for your next role across 13 sources
        <span className={styles.asciiCursor} />
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
      className={clsx(dragActive ? styles.cvDropActive : styles.cvDrop, busy && styles.cvDropBusy)}
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
          <strong>Drop your CV here</strong> (.pdf / .docx / .md / .txt). The LLM CLI runs locally —
          no upload to any server.
        </div>
        <label className={styles.cvDropActions}>
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
          <span className={buttonStyles.secondary}>
            {busy && <span className={spinnerStyles.spinner} aria-hidden />}
            {busy ? 'Working…' : 'Choose file'}
          </span>
        </label>
      </div>
    </section>
  );
}
