/**
 * MCP server endpoint (Streamable HTTP).
 *
 * Exposes read-write tools over the user's programs, training cycles, and
 * profile/weight to any MCP client (Claude Desktop/Code, etc.). The endpoint
 * resolves to /api/mcp.
 *
 * Auth: `requireMcpAuth` (@better-auth/mcp) verifies the OAuth bearer token on
 * every request (signature against the app's JWKS, issuer, expiry, and an
 * audience of MCP_RESOURCE) and hands us its claims. We pass only the token's
 * subject, the user id, into the tools — userId is never a tool parameter, so a
 * client can never act on another user's data. Unauthenticated calls get a 401
 * whose WWW-Authenticate header starts the OAuth flow (see the .well-known
 * discovery routes).
 */

import { MCP_RESOURCE, auth } from "@/lib/auth";
import { checkRateLimit } from "@/lib/mcp/rate-limit";
import { registerCycleTools } from "@/lib/mcp/tools/cycles";
import { registerProfileTools } from "@/lib/mcp/tools/profile";
import { registerProgramTools } from "@/lib/mcp/tools/programs";
import { requireMcpAuth } from "@better-auth/mcp";
import { createMcpHandler } from "mcp-handler";

function serve(req: Request, claims: { sub?: string }) {
  // requireMcpAuth only invokes us with a verified token, but never register
  // user-scoped tools without a concrete userId — a falsy id must fail closed,
  // not fall through to queries scoped to `undefined`.
  const userId = claims.sub;
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
}

const handler = requireMcpAuth(auth, serve, { resource: MCP_RESOURCE });

export { handler as DELETE, handler as GET, handler as POST };
