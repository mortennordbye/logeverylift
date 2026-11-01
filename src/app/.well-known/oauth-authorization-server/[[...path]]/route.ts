/**
 * OAuth Authorization Server metadata (RFC 8414).
 *
 * Lets MCP clients discover this app's OAuth endpoints (authorize, token,
 * registration) so they can run the auth flow against the MCP server. Clients
 * ask for the bare path or the issuer-path-suffixed form; the OAuth provider
 * plugin answers both from inside Better Auth's handler.
 */

// Relative import (not the @/ alias): this dot-folder lives outside the tsconfig
// program, so the alias doesn't resolve here.
import { auth } from "../../../../lib/auth";

export const GET = (request: Request) => auth.handler(request);
