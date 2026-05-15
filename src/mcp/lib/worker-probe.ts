// Probe the apply-worker's PID file to report whether the worker is alive.
// Same logic as `probeWorker` in `ui/plugins/applyQueue.ts:46-70`, lifted so
// the MCP server can use it without cross-importing from `ui/`.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface WorkerLiveness {
  alive: boolean;
  pid: number | null;
  pidPath: string;
}

export async function probeWorker(
  pidAbsolutePath: string,
  repoRoot: string,
): Promise<WorkerLiveness> {
  const pidPath = path.relative(repoRoot, pidAbsolutePath);
  let raw: string;
  try {
    raw = await readFile(pidAbsolutePath, 'utf8');
  } catch {
    return { alive: false, pid: null, pidPath };
  }
  const pid = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    return { alive: false, pid: null, pidPath };
  }
  try {
    process.kill(pid, 0);
    return { alive: true, pid, pidPath };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // EPERM = process exists but we lack permission to signal it — treat as
    // alive. ESRCH (or anything else) = process gone, report stale.
    return code === 'EPERM' ? { alive: true, pid, pidPath } : { alive: false, pid: null, pidPath };
  }
}
