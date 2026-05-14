// [03] Scoring profile panel — view + regenerate config/profile.json from
// the brief.
//
// MED-7 (client side): consume the new `{ profile, generating }` response
// shape from /api/profile. While the server reports `generating: true`,
// the regenerate button is disabled and shows a "Background generation in
// flight…" label; the meta chip flips to a yellow "generating…" pill.

import { PERSONAL_KEYWORD_KEYS, PERSONAL_WEIGHT_KEYS } from '../constants/profileKeys.ts';
import { Section, SkeletonRows } from './shared.tsx';
import type { EnvInfo, ProfileGenerateResult, ScoringProfile } from './types.ts';

interface ScoringProfilePanelProps {
  profile: ScoringProfile | null;
  profileLoaded: boolean;
  generating: boolean;
  envInfo: EnvInfo | null;
  regenBusy: boolean;
  regenResult: ProfileGenerateResult | null;
  showRawProfile: boolean;
  onAskRegenerate: () => void;
  onToggleRaw: () => void;
}

export function ScoringProfilePanel({
  profile,
  profileLoaded,
  generating,
  envInfo,
  regenBusy,
  regenResult,
  showRawProfile,
  onAskRegenerate,
  onToggleRaw,
}: ScoringProfilePanelProps) {
  const missing = profileLoaded && !profile && !generating;
  return (
    <Section
      index="03"
      title="Scoring profile"
      subtitle="config/profile.json — auto-generated from your brief. Drives which roles surface."
      meta={
        <ProfileStatusChip
          profile={profile}
          profileLoaded={profileLoaded}
          generating={generating}
        />
      }
    >
      {missing ? (
        <div className="settings-empty">
          <p>
            <strong>No scoring profile yet.</strong> <code>config/profile.json</code> is gitignored
            and must be generated locally from your candidate brief.
          </p>
          <p className="muted">
            The aggregator (<code>pnpm run dev</code>) will refuse to run until this is generated.
            Click <em>Regenerate from brief</em> below — takes 10–20 seconds.
          </p>
        </div>
      ) : !profile ? (
        <SkeletonRows count={4} />
      ) : (
        <ProfileSummary profile={profile} />
      )}
      <div className="settings-actions">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={regenBusy || generating || !envInfo}
          onClick={onAskRegenerate}
        >
          {generating
            ? 'Background generation in flight…'
            : regenBusy
              ? 'Regenerating…'
              : 'Regenerate from brief'}
        </button>
        <button type="button" className="btn btn-primary" onClick={onToggleRaw}>
          {showRawProfile ? 'Hide raw JSON' : 'View raw JSON'}
        </button>
      </div>
      {regenResult && (
        <div className="settings-snippet">
          <p className="muted">
            ✓ Updated {regenResult.weightsChanged.length} weight
            {regenResult.weightsChanged.length === 1 ? '' : 's'} (
            {regenResult.weightsChanged.join(', ') || 'none'}) and{' '}
            {regenResult.keywordsChanged.length} keyword group
            {regenResult.keywordsChanged.length === 1 ? '' : 's'} (
            {regenResult.keywordsChanged.join(', ') || 'none'}).
          </p>
        </div>
      )}
      {showRawProfile && profile && (
        <pre className="settings-clean-output">{JSON.stringify(profile, null, 2)}</pre>
      )}
    </Section>
  );
}

interface ProfileStatusChipProps {
  profile: ScoringProfile | null;
  profileLoaded: boolean;
  generating: boolean;
}

function ProfileStatusChip({ profile, profileLoaded, generating }: ProfileStatusChipProps) {
  if (generating) {
    return <span className="settings-meta-pill settings-meta-pill-warn">generating…</span>;
  }
  if (profileLoaded && !profile) {
    return <span className="settings-meta-pill settings-meta-pill-err">missing</span>;
  }
  if (!profile) return null;
  const weights = profile.weights ?? {};
  const personalActive = PERSONAL_WEIGHT_KEYS.some((k) => (weights[k] ?? 0) > 0);
  if (personalActive) {
    return <span className="settings-meta-pill settings-meta-pill-ok">active</span>;
  }
  return <span className="settings-meta-pill settings-meta-pill-warn">needs tuning</span>;
}

function ProfileSummary({ profile }: { profile: ScoringProfile }) {
  const keywords = profile.keywords ?? {};
  const weights = profile.weights ?? {};
  const populatedKwGroups = PERSONAL_KEYWORD_KEYS.filter((k) => {
    const v = keywords[k];
    return Array.isArray(v) && v.length > 0;
  });
  const activeWeightCount = PERSONAL_WEIGHT_KEYS.filter((k) => (weights[k] ?? 0) > 0).length;
  if (populatedKwGroups.length === 0 && activeWeightCount === 0) {
    return (
      <div className="settings-empty">
        <strong>Profile is neutral</strong>
        <p className="muted">
          No personal keywords or weights are set yet. Click "Regenerate from brief" to populate
          them based on <code>config/candidate-brief.md</code>.
        </p>
      </div>
    );
  }
  return (
    <ul className="profile-summary-list">
      {populatedKwGroups.map((k) => {
        const arr = keywords[k] as string[];
        const preview = arr.slice(0, 6).join(', ');
        const more = arr.length > 6 ? ` +${arr.length - 6} more` : '';
        return (
          <li key={k} className="profile-summary-row">
            <span className="profile-summary-key mono">{k}</span>
            <span className="profile-summary-value">
              {preview}
              {more}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
