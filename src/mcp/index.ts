// Pupila MCP server entrypoint. Boots a stdio transport and connects the
// configured `McpServer` from `server.ts`. Designed to be spawned by an MCP
// client (Claude Desktop, Cursor, Claude Code) via `pnpm run mcp` or
// `tsx src/mcp/index.ts`.
//
// IMPORTANT: `./lib/stdout-guard.js` MUST be the first import — it patches
// `console.log` / `console.info` / `console.warn` to redirect to stderr
// before any other module (including SDK and lib code) loads. Stdout is
// the JSON-RPC channel; a stray log corrupts the protocol stream.

import './lib/stdout-guard.js';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer, SERVER_NAME, SERVER_VERSION } from './server.js';

async function main(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();

  // Graceful shutdown — MCP clients send SIGTERM when the user removes the
  // server or the client process exits. SIGINT is for `Ctrl-C` when running
  // standalone via `pnpm run mcp`. Catch transport.close() rejections so
  // we don't silently swallow shutdown errors and still always exit.
  const shutdown = (signal: NodeJS.Signals): void => {
    process.stderr.write(`[mcp] received ${signal}, shutting down\n`);
    transport
      .close()
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[mcp] transport close error: ${msg}\n`);
      })
      .finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  await server.connect(transport);
  process.stderr.write(`[mcp] ${SERVER_NAME}@${SERVER_VERSION} ready on stdio\n`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[mcp] fatal: ${msg}\n`);
  process.exit(1);
});
