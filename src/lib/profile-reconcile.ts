// `config/profile.json` is a one-time copy of `config/profile.default.json`
// (bootstrap never overwrites it), so a corrected or newly added shipped
// `locationLock` fragment would never reach an existing user. This reconciles the
// two lists IN MEMORY at load time; the user's file on disk is not rewritten.
//
//  - shipped fragments missing from the personal list are added
//  - fragments that a previous release shipped and a later one replaced are
//    removed (they are over-broad: e.g. a bare `relocat(e|ion|ing)` also matches
//    "no relocation needed")
//  - fragments the user added themselves are kept untouched
//
// Trade-off: a shipped fragment the user deliberately deleted comes back on the
// next load. Locks are safety nets against wrongful keeps, so re-adding is the
// safer side; to tune the candidate's own preference, edit the `location` block.

/** Fragments shipped by earlier releases and since replaced by stricter ones. */
export const SUPERSEDED_LOCATION_LOCK = new Set([
  'in[- ]office only',
  'in[- ]office',
  'visa (sponsorship|sponsor|required|status)',
  'relocat(e|ion|ing)',
]);

export function reconcileLocationLock(
  personal: readonly string[],
  shipped: readonly string[],
): string[] {
  const kept = personal.filter((fragment) => !SUPERSEDED_LOCATION_LOCK.has(fragment));
  const have = new Set(kept);
  return [...kept, ...shipped.filter((fragment) => !have.has(fragment))];
}
