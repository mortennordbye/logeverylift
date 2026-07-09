import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = [
  "/login",
  "/signup",
  "/api/auth",
  "/api/health",
  "/api/ready",
  // MCP server: clients authenticate with an OAuth Bearer token (not the
  // session cookie), so skip the cookie check here — withMcpAuth enforces auth
  // inside the route. The .well-known routes serve OAuth discovery metadata and
  // must be reachable by unauthenticated MCP clients.
  "/api/mcp",
  "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-protected-resource",
];

// Static PWA assets that must be publicly accessible (e.g. iOS home-screen icon fetch)
const PUBLIC_FILES = [
  "/apple-touch-icon.png",
  "/icon-192x192.png",
  "/icon-512x512.png",
  "/favicon-32.png",
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths and static PWA assets
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }
  if (PUBLIC_FILES.includes(pathname)) {
    return NextResponse.next();
  }

  // Fast edge check: presence of the Better Auth session cookie.
  // Full cryptographic verification happens inside requireSession() in each
  // Server Component / Server Action.
  const sessionToken =
    request.cookies.get("better-auth.session_token") ??
    request.cookies.get("__Secure-better-auth.session_token");

  if (!sessionToken) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match everything except Next.js internals and static assets
    "/((?!_next/static|_next/image|favicon.ico|icons|manifest|sw\\.js|workbox-).*)",
  ],
};
