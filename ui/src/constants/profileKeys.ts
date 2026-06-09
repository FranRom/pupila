// MIRROR of src/lib/profile-generator.ts PERSONAL_*_KEYS — keep in sync.
// The UI runs in the browser; profile-generator.ts depends on Node's
// child_process via runLlm and cannot be imported here.

export const PERSONAL_WEIGHT_KEYS = [
  'web3TitleBody',
  'web3Stack',
  'aiTitleBody',
  'aiStack',
  'stackPrimary',
  'stackRn',
  'stackOther',
  'roleTitle',
  'roleBody',
] as const;

export const PERSONAL_KEYWORD_KEYS = [
  'stackPrimary',
  'stackRn',
  'stackOther',
  'w3TitleBody',
  'w3Stack',
  'aiTitleBody',
  'aiStack',
  'titleExcludedSpecialties',
] as const;

export type PersonalWeightKey = (typeof PERSONAL_WEIGHT_KEYS)[number];
export type PersonalKeywordKey = (typeof PERSONAL_KEYWORD_KEYS)[number];
