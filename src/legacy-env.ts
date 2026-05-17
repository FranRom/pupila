const RENAMES: ReadonlyArray<[string, string]> = [
  ['JOB_HUNT_LLM', 'PUPILA_LLM'],
  ['JOB_HUNT_LLM_FLAG', 'PUPILA_LLM_FLAG'],
  ['JOB_HUNT_LLM_TIMEOUT_MS', 'PUPILA_LLM_TIMEOUT_MS'],
  ['JOB_HUNT_CV_MAX_CHARS', 'PUPILA_CV_MAX_CHARS'],
  ['JOB_HUNT_NO_BRIEF_CHECK', 'PUPILA_NO_BRIEF_CHECK'],
  ['JOB_HUNT_FEED_TITLE', 'PUPILA_FEED_TITLE'],
  ['JOB_HUNT_FEED_DESC', 'PUPILA_FEED_DESC'],
  ['JOB_HUNT_FEED_LINK', 'PUPILA_FEED_LINK'],
];

export function detectLegacyEnvVars(
  env: NodeJS.ProcessEnv,
): Array<{ old: string; replacement: string }> {
  return RENAMES.filter(([oldName]) => env[oldName] !== undefined).map(([old, replacement]) => ({
    old,
    replacement,
  }));
}
