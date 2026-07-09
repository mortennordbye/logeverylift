/**
 * MCP server endpoint (Streamable HTTP).
 *
 * Exposes read-write tools over the user's programs, training cycles, and
 * profile/weight to any MCP client (Claude Desktop/Code, etc.). The endpoint
 * resolves to /api/mcp.
 *
 * Auth: `withMcpAuth` (Better Auth MCP plugin) validates the OAuth bearer token
 * on every request and hands us the access-token record. We pass only
 * `session.userId` into the tools — userId is never a tool parameter, so a
 * client can never act on another user's data. Unauthenticated calls get a 401
 * that kicks off the OAuth flow (see the .well-known discovery routes).
 */

import { auth } from "@/lib/auth";
import { checkRateLimit } from "@/lib/mcp/rate-limit";
import { registerCycleTools } from "@/lib/mcp/tools/cycles";
import { registerProfileTools } from "@/lib/mcp/tools/profile";
import { registerProgramTools } from "@/lib/mcp/tools/programs";
import { withMcpAuth } from "better-auth/plugins";
import { createMcpHandler } from "mcp-handler";

const handler = withMcpAuth(auth, (req, session) => {
  // withMcpAuth only invokes us with a validated token, but never register
  // user-scoped tools without a concrete userId — a falsy id must fail closed,
  // not fall through to queries scoped to `undefined`.
  const userId = session.userId;
  if (!userId) {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Unauthorized" },
        id: null,
      }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
  }

  // Failsafe against a runaway client hammering the tools (in-memory, fine for
  // a single instance — see src/lib/mcp/rate-limit.ts).
  if (!checkRateLimit(userId)) {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Rate limit exceeded. Please slow down." },
        id: null,
      }),
      { status: 429, headers: { "content-type": "application/json" } },
    );
  }

  return createMcpHandler(
    (server) => {
      registerProfileTools(server, userId);
      registerProgramTools(server, userId);
      registerCycleTools(server, userId);
    },
    {},
    { basePath: "/api" },
  )(req);
});

export { handler as DELETE, handler as GET, handler as POST };
