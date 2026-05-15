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

// MCP's `CallToolResult` carries an index signature for forward-compat with
// future content kinds. Matching that shape here lets `registerTool` accept
// our handlers without an awkward cast at every call site.
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

function describeUnknown(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unexpected error';
}

/**
 * Higher-order wrapper for tool handlers. Catches any throw, logs the
 * detailed error to STDERR (stdout is the JSON-RPC channel for stdio
 * transport — writing there would corrupt framing), and returns a clean
 * error envelope.
 *
 * Use this around every tool handler. The MCP SDK's request-handler shape
 * varies slightly between versions, so this returns the inner handler with
 * an unknown-typed argument; cast at the registration site.
 */
export function safeHandler<TArgs, TResult extends ToolResult>(
  toolName: string,
  fn: (args: TArgs) => Promise<TResult>,
): (args: TArgs) => Promise<TResult | ToolResult> {
  return async (args: TArgs) => {
    try {
      return await fn(args);
    } catch (err) {
      // STDERR only — never console.log here.
      process.stderr.write(`[mcp:${toolName}] ${describeUnknown(err)}\n`);
      return toolError(`${toolName} failed: ${describeUnknown(err)}`);
    }
  };
}
