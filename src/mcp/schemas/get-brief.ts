// `get_brief` is a zero-arg tool, but McpServer requires a schema shape (it
// uses Zod to derive both the typed handler signature and the wire-level
// JSON Schema). An empty object schema gives clients a defined contract.
export const getBriefInputSchema = {};
