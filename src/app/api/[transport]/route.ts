/**
 * MCP server endpoint (Streamable HTTP).
 *
 * Exposes read-write tools over the user's programs, training cycles,
 * profile/weight and exercises, tools that read their workout history and log
 * or confirm sessions, to any MCP client (Claude Desktop/Code, etc.). The endpoint
 * resolves to /api/mcp.
 *
 * Auth: `requireMcpAuth` (@better-auth/mcp) verifies the OAuth bearer token on
 * every request (signature against the app's JWKS, issuer, expiry, and an
 * audience of MCP_RESOURCE) and hands us its claims. We pass only the token's
 * subject, the user id, into the tools — userId is never a tool parameter, so a
 * client can never act on another user's data. Unauthenticated calls get a 401
 * whose WWW-Authenticate header starts the OAuth flow (see the .well-known
 * discovery routes).
 *
 * Access (docs/plans/mcp-access.md): the token's scopes narrowed by the user's
 * live consent for the client (src/lib/mcp/access.ts). No consent means the
 * user disconnected the assistant, so the request gets a 401 and the client
 * starts over; no mcp scope gets a 403 insufficient_scope. Read-only access
 * registers the tools through scopedServer, which makes write tools refuse.
 */

import { MCP_RESOURCE, auth } from "@/lib/auth";
import { connectionAccess } from "@/lib/mcp/access";
import { serverInstructions } from "@/lib/mcp/instructions";
import { checkRateLimit } from "@/lib/mcp/rate-limit";
import { loadResourceDocs, registerResources } from "@/lib/mcp/resources";
import { MCP_SCOPES, scopedServer } from "@/lib/mcp/scopes";
import { registerCoachMemoryTools } from "@/lib/mcp/tools/coach-memory";
import { registerCycleTools } from "@/lib/mcp/tools/cycles";
import { registerExerciseTools } from "@/lib/mcp/tools/exercises";
import { registerGarminTools } from "@/lib/mcp/tools/garmin";
import { registerProfileTools } from "@/lib/mcp/tools/profile";
import { registerProgramTools } from "@/lib/mcp/tools/programs";
import { registerSessionTools } from "@/lib/mcp/tools/sessions";
import { registerWorkoutTools } from "@/lib/mcp/tools/workouts";
import { requireMcpAuth } from "@better-auth/mcp";
import { createResourceServerChallenge } from "@better-auth/oauth-provider";
import { APIError } from "better-auth/api";
import { createInsufficientScopeError } from "better-auth/oauth2";
import { createMcpHandler } from "mcp-handler";
import { garminAllowedFor } from "@/lib/garmin/access";

/** The 401 an unauthenticated request gets, so the client runs OAuth again. */
function revokedResponse(): Response {
  const challenge = createResourceServerChallenge(
    new APIError("UNAUTHORIZED", { message: "This connection was disconnected. Connect again." }),
    MCP_RESOURCE,
    { challengeScopes: MCP_SCOPES },
  )!;
  const headers = new Headers(challenge.headers);
  headers.set("content-type", "application/json");
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: challenge.message }, id: null }),
    { status: challenge.statusCode, headers },
  );
}

async function serve(req: Request, claims: { sub?: string; azp?: unknown; scope?: unknown }) {
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

  const connection = await connectionAccess(
    userId,
    typeof claims.azp === "string" ? claims.azp : undefined,
    typeof claims.scope === "string" ? claims.scope : undefined,
  );
  if (connection.kind === "revoked") return revokedResponse();
  if (connection.kind === "no_scope") {
    // requireMcpAuth turns this into a 403 naming the scopes, so the client can step up.
    throw createInsufficientScopeError(MCP_SCOPES, "This connection has no LogEveryLift access. Connect again.");
  }
  const { access } = connection;
  const clientId = typeof claims.azp === "string" ? claims.azp : undefined;

  // Garmin tools only for accounts allowed to use Garmin (src/lib/garmin/access.ts).
  const [garmin, docs] = await Promise.all([garminAllowedFor(userId), loadResourceDocs()]);
  return createMcpHandler(
    (mcpServer) => {
      const server = scopedServer(mcpServer, access);
      registerProfileTools(server, userId);
      // The OAuth client tags assistant revisions, so the AI changes feed can
      // name the assistant and group its writes (docs/plans/revisions.md, 2.8).
      registerProgramTools(server, userId, clientId);
      registerCycleTools(server, userId, clientId);
      registerWorkoutTools(server, userId);
      registerSessionTools(server, userId);
      registerExerciseTools(server, userId);
      registerCoachMemoryTools(server, userId, clientId);
      if (garmin) registerGarminTools(server, userId);
      registerResources(mcpServer, docs);
    },
    { instructions: serverInstructions(access) },
    { basePath: "/api" },
  )(req);
}

const handler = requireMcpAuth(auth, serve, { resource: MCP_RESOURCE, challengeScopes: MCP_SCOPES });

export { handler as DELETE, handler as GET, handler as POST };
