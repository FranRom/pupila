#!/usr/bin/env node
// Helper for install-mcp.sh — merge a single MCP server entry into a
// client-specific JSON config file without trampling other entries the user
// may already have configured. Doing this in Node avoids a hard `jq`
// dependency.
//
// Usage:
//   node _merge-mcp-config.mjs <configPath> <serverName> <commandJson>
//
// Args:
//   configPath:   absolute path to the client's MCP config JSON file
//   serverName:   the key under "mcpServers" to write (e.g. "pupila")
//   commandJson:  a JSON string for the server entry value
//                 e.g. '{"command":"pnpm","args":["--dir","/path","run","mcp"]}'
//
// Behavior:
//   - If configPath doesn't exist, creates it with parent directories.
//   - If "mcpServers" key is missing, adds it.
//   - If the server entry already exists, OVERWRITES it (idempotent re-runs
//     update to the latest command).
//   - Pretty-prints with 2-space indent + trailing newline.
//   - Exits non-zero with a stderr message on any parse failure.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const [, , configPath, serverName, commandJson] = process.argv;

if (!configPath || !serverName || !commandJson) {
  process.stderr.write(
    'usage: _merge-mcp-config.mjs <configPath> <serverName> <commandJson>\n',
  );
  process.exit(2);
}

async function readJsonOrEmpty(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (err) {
    if (err && err.code === 'ENOENT') return {};
    throw err;
  }
}

let serverEntry;
try {
  serverEntry = JSON.parse(commandJson);
} catch (err) {
  process.stderr.write(`invalid commandJson: ${err.message}\n`);
  process.exit(3);
}

try {
  const existing = await readJsonOrEmpty(configPath);
  if (typeof existing !== 'object' || existing === null || Array.isArray(existing)) {
    process.stderr.write(`refusing to overwrite non-object config at ${configPath}\n`);
    process.exit(4);
  }
  const next = {
    ...existing,
    mcpServers: {
      ...(existing.mcpServers ?? {}),
      [serverName]: serverEntry,
    },
  };
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  process.stdout.write(`updated ${configPath}\n`);
} catch (err) {
  process.stderr.write(`merge failed: ${err.message}\n`);
  process.exit(5);
}
