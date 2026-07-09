/**
 * OAuth Protected Resource discovery metadata.
 *
 * Modern MCP clients fetch this first to learn which authorization server
 * protects the MCP resource. Points back to this app's Better Auth OAuth server.
 */

// Relative import (not the @/ alias): this dot-folder lives outside the tsconfig
// program, so the alias doesn't resolve here. Matches the Better Auth docs.
import { oAuthProtectedResourceMetadata } from "better-auth/plugins";
import { auth } from "../../../lib/auth";

export const GET = oAuthProtectedResourceMetadata(auth);
