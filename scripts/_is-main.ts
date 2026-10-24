import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * True when the module at `metaUrl` is the process entry point. `import.meta.url`
 * is resolved through realpath, so `argv[1]` must be too, or running the script
 * through a symlink (or a path containing `#`/`?`) would silently do nothing.
 */
export function isMain(metaUrl: string, argv1: string | undefined = process.argv[1]): boolean {
  if (!argv1) return false;
  try {
    return metaUrl === pathToFileURL(realpathSync(argv1)).href;
  } catch {
    return false;
  }
}
