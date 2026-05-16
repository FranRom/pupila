import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readBriefBody } from '../../lib/brief-template.js';
import { safeHandler, type ToolResult, toolJson } from '../errors.js';
import { BRIEF_PATH } from '../paths.js';
import { getBriefInputSchema } from '../schemas/get-brief.js';

// Repo-relative path returned to the client. The absolute path resolved from
// `import.meta.url` is an implementation detail and would leak the user's
// home directory layout to whichever LLM is driving the MCP client.
const REPO_RELATIVE_BRIEF_PATH = 'config/candidate-brief.md';

export async function runGetBrief(briefPath: string = BRIEF_PATH): Promise<ToolResult> {
  const body = await readBriefBody(briefPath);
  return toolJson({
    exists: body !== null,
    body,
    path: REPO_RELATIVE_BRIEF_PATH,
  });
}

export function registerGetBrief(server: McpServer): void {
  server.registerTool(
    'get_brief',
    {
      title: 'Get candidate brief',
      description:
        'Return the contents of config/candidate-brief.md (the natural-language candidate description fed to the AI reviewer and AI Apply flows). Returns { exists: boolean, body: string | null, path: string }. body is null when the file is missing.',
      inputSchema: getBriefInputSchema,
    },
    safeHandler('get_brief', () => runGetBrief()),
  );
}
