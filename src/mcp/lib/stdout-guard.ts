// Side-effect module: imported FIRST in src/mcp/index.ts to redirect any
// stray `console.log` / `console.info` / `console.warn` away from stdout
// before any other module (including transitively-imported lib code) loads.
//
// MCP stdio transport uses stdout as the JSON-RPC framing channel. A single
// stray "[applyQueue] enqueued X" log line would corrupt the protocol and
// the MCP client would silently drop the connection. The SDK writes via
// `process.stdout.write` directly — patching `console.*` is enough to
// catch the common offenders without breaking SDK output.
//
// `console.error` and `console.debug` already go to stderr and are left
// alone. `process.stdout.write` is left alone so the SDK can do its job.

const STDERR_LEVELS = ['log', 'info', 'warn'] as const;

function redirect(level: (typeof STDERR_LEVELS)[number]): void {
  const prefix = level === 'log' ? '' : `[${level}] `;
  console[level] = (...args: unknown[]): void => {
    const text = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    process.stderr.write(`${prefix}${text}\n`);
  };
}

for (const level of STDERR_LEVELS) redirect(level);
