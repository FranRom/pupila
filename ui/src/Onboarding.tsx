import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OllamaModelGroup } from './components/OllamaModelGroup.tsx';
import { api, formatError } from './lib/api/index.ts';
import { useLlmStream } from './lib/use-llm-stream.ts';
import styles from './Onboarding.module.css';
import { StreamingPanel } from './StreamingPanel.tsx';
import { PROVIDER_META, PROVIDERS, type Provider, type ProviderChoice } from './settings/types.ts';
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

type CvFormat = 'pdf' | 'docx' | 'md' | 'txt';
// Mirrors BriefSource in src/lib/brief-prompt.ts — kept as a local literal so
// the UI doesn't import server code. 'linkedin' just switches the LLM prompt.
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
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [provider, setProvider] = useState<ProviderChoice>('auto');
  const [ollamaModel, setOllamaModel] = useState<string | null>(null);
  // Set while /api/llm-detect is in flight. Drives the Re-check button label so
  // a user who just installed a CLI in another terminal sees feedback without a
  // page refresh.
  const [probing, setProbing] = useState(false);
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

  // Probe installed-CLI status + Ollama models. Runs on mount and again
  // whenever the user clicks "Re-check" after downloading/installing.
  const probe = useCallback(async (signal?: AbortSignal) => {
    setProbing(true);
    try {
      const r = await api.llm.detect({ signal });
      if (!r.ok) {
        if (r.error.kind === 'abort') return;
        setError(`Could not probe LLM CLIs: ${formatError(r.error)}`);
        return;
      }
      setAvailable(r.value.available);
      const models = r.value.ollamaModels ?? [];
      setOllamaModels(models);
      // Pre-select the first installed CLI as a sensible default. Prefer a
      // subscription CLI; if only Ollama is available, pick its first model.
      const firstCli = PROVIDERS.find((p) => p !== 'ollama' && r.value.available[p]);
      if (firstCli) {
        setProvider(firstCli);
        setOllamaModel(null);
      } else if (r.value.available.ollama && models[0]) {
        setProvider('ollama');
        setOllamaModel(models[0]);
      }
    } finally {
      setProbing(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    void probe(ctrl.signal);
    return () => ctrl.abort();
  }, [probe]);

  const anyAvailable = useMemo(() => {
    if (!available) return false;
    if (PROVIDERS.some((p) => p !== 'ollama' && available[p])) return true;
    return Boolean(available.ollama && ollamaModels.length > 0);
  }, [available, ollamaModels]);

  const canProceed = anyAvailable && (provider !== 'ollama' || Boolean(ollamaModel));

  // The picked Ollama model is kept when switching to Auto or a CLI: it is
  // inert for CLI providers and needed if auto-detect later lands on Ollama.
  const selectCli = useCallback((p: ProviderChoice) => {
    setProvider(p);
  }, []);

  const selectOllamaModel = useCallback((name: string) => {
    setProvider('ollama');
    setOllamaModel(name);
  }, []);

  const uploadCv = useCallback(
    async (file: File, source: BriefSource = 'cv') => {
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
        const done = await cv.start({
          format,
          data,
          source,
          provider: provider === 'auto' ? null : provider,
          model: ollamaModel,
        });
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
    [cv, provider, ollamaModel],
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
    const prefR = await api.preferences.set({
      provider,
      ollamaModel,
    });
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
    const tuneDone = await tune.start({
      provider: provider === 'auto' ? null : provider,
      model: ollamaModel,
    });
    if (!tuneDone && tune.error) {
      console.warn('[onboarding] profile generation failed; continuing anyway:', tune.error);
    }
    setTuning(false);
    setBusy(false);
    onComplete();
  }, [briefDraft, generatedBrief, provider, ollamaModel, onComplete, tune]);

  return (
    <div className={styles.wizard}>
      <header className={styles.header}>
        <AsciiHero />
        <p className={styles.subtitle}>
          A 30-second setup. Pick your LLM, drop your CV, confirm the generated brief.
        </p>
        <ol className={styles.progress}>
          <li className={step === 'provider' ? styles.progressCurrent : styles.progressDone}>
            1. LLM
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
          <h2>Pick your LLM</h2>
          <p>
            Pupila uses a local LLM for the CV summary, per-job AI review, and AI Apply — no cloud
            API keys. Pick a subscription CLI you already have authenticated, or one of your locally
            pulled Ollama models.
          </p>
          <p className={styles.installHelp}>
            ⚠️ Subscription options are <strong>command-line tools</strong> you run in your terminal
            — not desktop apps. In particular, <strong>Claude Code</strong> is the terminal tool,{' '}
            <em>not</em> the Claude desktop app. Click <strong>Download</strong>, follow the install
            guide, then press <strong>Re-check</strong>.
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
                    onChange={() => selectCli('auto')}
                  />
                  <strong>Auto-detect</strong>
                  <span className={styles.muted}>
                    — picks the first installed in claude → codex → gemini → opencode → ollama order
                  </span>
                </label>
              </li>
              {PROVIDERS.filter((p) => p !== 'ollama').map((p) => {
                const installed = available[p];
                const meta = PROVIDER_META[p];
                return (
                  <li key={p}>
                    <label>
                      <input
                        type="radio"
                        name="provider"
                        value={p}
                        checked={provider === p}
                        onChange={() => selectCli(p)}
                        disabled={!installed}
                      />
                      <strong>{meta.label}</strong>
                      <span className={installed ? styles.available : styles.unavailable}>
                        {installed ? '✓ installed' : '✗ not installed'}
                      </span>
                      {!installed && (
                        <a
                          className={styles.installLink}
                          href={meta.installUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Download ↗
                        </a>
                      )}
                    </label>
                  </li>
                );
              })}
              <OllamaModelGroup
                header={
                  <>
                    <strong>{PROVIDER_META.ollama.label}</strong>
                    <span className={available.ollama ? styles.available : styles.unavailable}>
                      {available.ollama ? '✓ installed' : '✗ not installed'}
                    </span>
                    {!available.ollama && (
                      <a
                        className={styles.installLink}
                        href={PROVIDER_META.ollama.installUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Download ↗
                      </a>
                    )}
                  </>
                }
                radioName="provider"
                models={available.ollama ? ollamaModels : []}
                selected={provider === 'ollama' ? ollamaModel : null}
                onSelect={selectOllamaModel}
              >
                {available.ollama && ollamaModels.length === 0 && (
                  <p className={styles.muted}>
                    No models pulled yet. Run <code>ollama pull qwen3:14b</code> (or another model),
                    then Re-check.
                  </p>
                )}
              </OllamaModelGroup>
            </ul>
          )}
          {!anyAvailable && available && (
            <p className={styles.warn}>
              No supported CLI or Ollama model found. Download a CLI above, or install Ollama and{' '}
              <code>ollama pull</code> a model, then press Re-check.
            </p>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              className={buttonStyles.primary}
              disabled={probing || busy}
              onClick={() => void probe()}
            >
              {probing && <span className={spinnerStyles.spinner} aria-hidden />}
              {probing ? 'Re-checking…' : 'Re-check'}
            </button>
            <button
              type="button"
              className={buttonStyles.secondary}
              disabled={!canProceed || busy}
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
            We'll send the contents to your local{' '}
            <code>{provider === 'ollama' && ollamaModel ? `ollama/${ollamaModel}` : provider}</code>{' '}
            to generate a short candidate brief. The original file stays on disk at{' '}
            <code>config/cv.&lt;ext&gt;</code> (gitignored) so AI Apply can re-attach it later.
          </p>
          <CvDropZone busy={busy} onFile={(f) => uploadCv(f, 'cv')} />
          <LinkedinImport busy={busy} onFile={(f) => uploadCv(f, 'linkedin')} />
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
            provider={
              provider === 'auto'
                ? null
                : provider === 'ollama' && ollamaModel
                  ? `ollama/${ollamaModel}`
                  : provider
            }
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
            provider={
              provider === 'auto'
                ? null
                : provider === 'ollama' && ollamaModel
                  ? `ollama/${ollamaModel}`
                  : provider
            }
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
  ' ____  _   _ ____ ___ _        _    ',
  '|  _ \\| | | |  _ \\_ _| |      / \\   ',
  '| |_) | | | | |_) | || |     / _ \\  ',
  '|  __/| |_| |  __/| || |___ / ___ \\ ',
  '|_|    \\___/|_|  |___|_____/_/   \\_\\',
];

function AsciiHero() {
  return (
    <div className={styles.asciiHero} role="img" aria-label="PUPILA">
      {ASCII_HERO_LINES.map((line) => (
        <span key={line} className={styles.asciiLine}>
          {line}
        </span>
      ))}
      <span className={styles.asciiTag}>
        &gt; watching for your next role across several sources
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
  const fileInputRef = useRef<HTMLInputElement>(null);
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
        <div className={styles.cvDropActions}>
          <button
            type="button"
            className={buttonStyles.secondary}
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            {busy && <span className={spinnerStyles.spinner} aria-hidden />}
            {busy ? 'Working…' : 'Choose file'}
          </button>
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.md,.markdown,.txt"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </section>
  );
}

interface LinkedinImportProps {
  busy: boolean;
  onFile: (f: File) => void;
}

// Optional alternative to dropping a CV: import a LinkedIn profile. There's no
// supported way to scrape LinkedIn (auth + ToS), so we use the self-serve
// "Save to PDF" export — a 5-minute, no-login-needed action — and feed that PDF
// through the same parse→LLM brief pipeline with a LinkedIn-tuned prompt.
// Collapsed by default so it stays out of the way of the primary CV drop.
function LinkedinImport({ busy, onFile }: LinkedinImportProps) {
  const [open, setOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  return (
    <section className={styles.linkedin}>
      <button
        type="button"
        className={styles.linkedinToggle}
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? '▾' : '▸'} No recent CV? Import from LinkedIn instead{' '}
        <span className={styles.muted}>(optional)</span>
      </button>
      {open && (
        <div className={styles.linkedinBody}>
          <p>
            Haven't updated a CV in a while? Export your LinkedIn profile as a PDF and we'll build
            the brief from that:
          </p>
          <ol className={styles.linkedinSteps}>
            <li>
              On your LinkedIn profile, click <strong>More</strong> → <strong>Save to PDF</strong>.
            </li>
            <li>Upload the downloaded PDF here.</li>
          </ol>
          <div className={styles.linkedinActions}>
            <button
              type="button"
              className={buttonStyles.secondary}
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              {busy && <span className={spinnerStyles.spinner} aria-hidden />}
              {busy ? 'Working…' : 'Upload LinkedIn PDF'}
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = '';
            }}
          />
        </div>
      )}
    </section>
  );
}
