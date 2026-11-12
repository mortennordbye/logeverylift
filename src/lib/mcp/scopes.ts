/**
 * MCP access levels (docs/plans/mcp-access.md, 2.1; decision D5).
 *
 * The user picks one on the consent page: read only (`mcp:read`) or read and
 * change (`mcp:read mcp:write`). A request's access is the token's scopes
 * narrowed by the scopes on the user's live consent for that client, so a
 * disconnect or a downgrade takes effect on the next request, not when the
 * JWT expires.
 *
 * Every tool is a read tool only if it says so with `readOnlyHint: true`.
 * Anything else needs write access, so a new tool with no hint fails closed.
 */

import { fail } from "@/lib/mcp/result";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const MCP_READ_SCOPE = "mcp:read";
export const MCP_WRITE_SCOPE = "mcp:write";
export const MCP_SCOPES = [MCP_READ_SCOPE, MCP_WRITE_SCOPE] as const;

export type McpAccess = "read" | "write";

export const READ_ONLY_REFUSAL =
  "This connection is read-only. To let the assistant make changes, the user can disconnect it in LogEveryLift (More → Connected assistants) and connect again with read and change access.";

/**
 * The access a request has, or null for none. `consentScopes` null means the
 * user has no consent for this client (never given, or disconnected).
 */
export function effectiveAccess(tokenScope: string | undefined, consentScopes: string[] | null): McpAccess | null {
  if (!consentScopes) return null;
  const token = new Set((tokenScope ?? "").split(" ").filter(Boolean));
  return accessFromScopes(consentScopes.filter((s) => token.has(s)));
}

/** The access a list of granted scopes gives, or null if it holds no mcp scope. */
export function accessFromScopes(scopes: string[]): McpAccess | null {
  if (scopes.includes(MCP_WRITE_SCOPE)) return "write";
  if (scopes.includes(MCP_READ_SCOPE)) return "read";
  return null;
}

/**
 * The scope the consent page sends for the user's choice: what the client
 * asked for, without mcp:write for read only. The provider accepts only a
 * subset of the request.
 */
export function consentScope(requested: string[], access: McpAccess): string {
  return requested.filter((s) => access === "write" || s !== MCP_WRITE_SCOPE).join(" ");
}

/** Whether a tool's config marks it as read-only. */
export function isReadTool(config: { annotations?: { readOnlyHint?: boolean } }): boolean {
  return config.annotations?.readOnlyHint === true;
}

/** Registration methods on McpServer that the read-only wrapper does not check. */
const UNSCOPED_REGISTRATIONS = new Set(["tool", "prompt", "registerPrompt", "resource", "registerResource"]);

/**
 * The server the tool modules register on. With write access it is the server
 * itself. With read access, write tools stay listed so the model knows they
 * exist, but their handler refuses without running. Every other registration
 * method throws, so nothing reaches the client unchecked.
 */
export function scopedServer(server: McpServer, access: McpAccess): McpServer {
  if (access === "write") return server;
  type ToolConfig = { description?: string; annotations?: { readOnlyHint?: boolean } };
  const registerTool = ((name: string, config: ToolConfig, handler: unknown) => {
    if (isReadTool(config)) return server.registerTool(name, config as never, handler as never);
    return server.registerTool(
      name,
      { ...config, description: `${config.description ?? ""} (Needs read and change access; this connection is read-only.)` },
      (async () => {
        console.info("[mcp:scope] refused", { tool: name });
        return fail(READ_ONLY_REFUSAL);
      }) as never,
    );
  }) as McpServer["registerTool"];
  return new Proxy(server, {
    get(target, prop) {
      if (prop === "registerTool") return registerTool;
      // Fail closed: any other way to add something callable would skip the
      // read-only check, so it throws instead of registering.
      if (typeof prop === "string" && UNSCOPED_REGISTRATIONS.has(prop)) {
        return () => {
          throw new Error(`scopedServer: ${prop}() is not scoped; register tools with registerTool`);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
