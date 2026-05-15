import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readBriefBody } from '../../lib/brief-template.js';
import { safeHandler, toolJson } from '../errors.js';
import { BRIEF_PATH } from '../paths.js';
import { getBriefInputSchema } from '../schemas/get-brief.js';

export async function runGetBrief(briefPath: string = BRIEF_PATH) {
  const body = await readBriefBody(briefPath);
  return toolJson({
    exists: body !== null,
    body,
    path: briefPath,
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
    safeHandler('get_brief', async () => runGetBrief()),
  );
}
