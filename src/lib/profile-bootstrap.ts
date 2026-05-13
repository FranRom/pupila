import { constants as fsConstants } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import path from 'node:path';

// Atomically copies config/profile.default.json -> config/profile.json the
// first time the aggregator or the UI sees a missing personal profile. The
// copy uses COPYFILE_EXCL, so if profile.json already exists the call is a
// no-op (no risk of clobbering a personalized file in a race). Returns true
// when the bootstrap actually happened, false when the file was already there.

export const DEFAULT_PROFILE_PATH = path.join('config', 'profile.default.json');
export const PROFILE_PATH = path.join('config', 'profile.json');

export interface BootstrapResult {
  bootstrapped: boolean;
  defaultPath: string;
  profilePath: string;
}

export async function bootstrapProfileIfMissing(opts?: {
  defaultPath?: string;
  profilePath?: string;
}): Promise<BootstrapResult> {
  const defaultPath = opts?.defaultPath ?? DEFAULT_PROFILE_PATH;
  const profilePath = opts?.profilePath ?? PROFILE_PATH;
  try {
    await copyFile(defaultPath, profilePath, fsConstants.COPYFILE_EXCL);
    return { bootstrapped: true, defaultPath, profilePath };
  } catch (err) {
    // EEXIST is the expected steady-state — profile.json already personalized.
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      return { bootstrapped: false, defaultPath, profilePath };
    }
    throw err;
  }
}
