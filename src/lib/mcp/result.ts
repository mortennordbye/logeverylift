/**
 * Shared helpers for MCP tool results.
 *
 * MCP tools return a `CallToolResult`. We serialise data as pretty JSON text —
 * adequate for an LLM client to read — and flag failures with `isError` so the
 * client can surface them instead of treating the message as data.
 */

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

/** Success result carrying JSON-serialised data. */
export function ok(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

/**
 * Error result with a controlled, safe message (e.g. "Program not found").
 * Only pass strings that are safe to show the client — never raw exceptions.
 */
export function fail(message: string): ToolResult {
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

/**
 * For unexpected exceptions in a tool handler. Logs the real error server-side
 * (greppable, never returned to the client) and hands the client a generic
 * message — so internal details (SQL, column names, stack traces) don't leak.
 */
export function failInternal(action: string, error: unknown): ToolResult {
  console.error(`[mcp:${action}] unexpected error`, error);
  return fail("Something went wrong handling that request.");
}

/**
 * Audit line for a security-relevant mutation (destructive or state-changing).
 * Logs a tag plus ids only — never secrets, user input, or full records.
 */
export function audit(action: string, details: Record<string, string | number>) {
  console.info(`[mcp:audit] ${action}`, details);
}
