import type { JobSignals } from '../types.ts';

const SIGNAL_LABELS: Record<keyof JobSignals, string> = {
  web3TitleBody: 'web3 (title/body)',
  web3Stack: 'web3 stack',
  aiTitleBody: 'AI (title/body)',
  aiStack: 'AI stack',
  stackPrimary: 'React/Next/TS',
  stackRn: 'React Native',
  stackOther: 'GraphQL/Tailwind/Vite',
  leadTitle: 'lead title',
  seniorTitle: 'senior title',
  frontendTitle: 'frontend title',
  frontendBody: 'frontend body',
  locationRemote: 'remote-friendly',
  freshness7d: 'fresh ≤7d',
  freshness14d: 'fresh ≤14d',
  usCentricPenalty: 'US-centric penalty',
  rawTotal: '',
  capped: '',
};

export function SignalsList({ signals }: { signals: JobSignals }) {
  const fired = (Object.keys(signals) as (keyof JobSignals)[])
    .filter((k) => k !== 'rawTotal' && k !== 'capped')
    .map((k) => ({ key: k, label: SIGNAL_LABELS[k], value: signals[k] as number }))
    .filter((s) => s.value !== 0);
  return (
    <ul className="signals">
      {fired.map((s) => (
        <li key={s.key}>
          <span className="signal-label">{s.label}</span>
          <span className={s.value > 0 ? 'signal-pos' : 'signal-neg'}>
            {s.value > 0 ? '+' : ''}
            {s.value}
          </span>
        </li>
      ))}
      <li className="signal-total">
        <span className="signal-label">raw total</span>
        <span>{signals.rawTotal}</span>
      </li>
      {signals.capped && <li className="signal-total muted">(capped at 100)</li>}
    </ul>
  );
}
