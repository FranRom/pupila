// Error helpers for MCP tool handlers.
//
// MCP tools return `{ content: [...], isError?: boolean }` per the spec. We
// never throw out of a tool handler — exceptions bubbling into the SDK would
// be returned as JSON-RPC errors with stack-trace-shaped messages, which is
// both noisier than necessary for users and a small leak of internals.
//
// `safeHandler` wraps a handler so any throw is caught and converted to an
// error envelope. `toolError` is the manual escape hatch for precondition
// failures (e.g. "worker not running") where throwing would be overkill.

export interface ToolContent {
  type: 'text';
  text: string;
}

// MCP's `CallToolResult` schema has an open shape (`z.object(...).catchall(...)`)
// that materializes in TypeScript as `[key: string]: unknown`. Without this
// index signature here, `registerTool(name, config, handler)` rejects our
// handlers with "Index signature for type 'string' is missing in type
// 'ToolResult'". Keep it.
export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
  [key: string]: unknown;
}

/**
 * Build a successful tool result with JSON-stringified payload.
 *
 * MCP clients render `text` content directly; serializing structured data as
 * JSON inside a text block is the simplest universally-supported shape.
 */
export function toolJson(payload: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

/**
 * Build an error tool result. The `message` should be human-readable — it's
 * what the user sees in their MCP client.
 */
export function toolError(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

// Strip absolute filesystem paths from messages before returning them to the
// MCP client. Defense-in-depth: if a future tool calls `readFile` without
// catching internally, ENOENT-style messages would otherwise expose
// $HOME/<full-path> to whichever LLM is driving the client.
function sanitizePaths(message: string): string {
  return message.replace(/\/(?:[\w.-]+\/)+[\w.-]+/g, '<path>');
}

function describeUnknown(err: unknown): string {
  if (err instanceof Error) return sanitizePaths(err.message);
  if (typeof err === 'string') return sanitizePaths(err);
  return 'Unexpected error';
}

/**
 * Higher-order wrapper for tool handlers. Catches any throw, logs the
 * detailed error to STDERR (stdout is the JSON-RPC channel for stdio
 * transport — writing there would corrupt framing), and returns a clean
 * error envelope.
 *
 * Accepts a typed handler `(input: TInput) => Promise<ToolResult>` and
 * returns an SDK-shaped `(args: unknown) => Promise<ToolResult>`. The
 * `args -> TInput` cast happens ONCE here — safe because `registerTool`
 * validates against the input schema before the SDK invokes the handler.
 * Doing it at this boundary instead of every registration site means a
 * schema change forces a TInput change forces a runner-signature change,
 * with type errors propagating naturally.
 */
export function safeHandler<TInput>(
  toolName: string,
  fn: (input: TInput) => Promise<ToolResult>,
): (args: unknown) => Promise<ToolResult> {
  return async (args: unknown): Promise<ToolResult> => {
    try {
      return await fn(args as TInput);
    } catch (err) {
      // STDERR only — never console.log here.
      process.stderr.write(`[mcp:${toolName}] ${describeUnknown(err)}\n`);
      return toolError(`${toolName} failed: ${describeUnknown(err)}`);
    }
  };
}
