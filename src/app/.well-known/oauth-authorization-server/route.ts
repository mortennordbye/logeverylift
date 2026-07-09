/**
 * OAuth Authorization Server discovery metadata.
 *
 * Lets MCP clients discover this app's OAuth endpoints (authorize, token,
 * registration) so they can run the auth flow against the MCP server.
 */

// Relative import (not the @/ alias): this dot-folder lives outside the tsconfig
// program, so the alias doesn't resolve here. Matches the Better Auth docs.
import { oAuthDiscoveryMetadata } from "better-auth/plugins";
import { auth } from "../../../lib/auth";

export const GET = oAuthDiscoveryMetadata(auth);
