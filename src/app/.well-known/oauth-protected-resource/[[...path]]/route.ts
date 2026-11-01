/**
 * OAuth Protected Resource metadata (RFC 9728) for the MCP endpoint.
 *
 * MCP clients fetch this first to learn which authorization server protects
 * /api/mcp. The 401 from requireMcpAuth points at the path-suffixed form
 * (/.well-known/oauth-protected-resource/api/mcp); older clients ask for the
 * bare path. The `mcp` plugin answers both from inside Better Auth's handler.
 */

// Relative import (not the @/ alias): this dot-folder lives outside the tsconfig
// program, so the alias doesn't resolve here.
import { auth } from "../../../../lib/auth";

export const GET = (request: Request) => auth.handler(request);
