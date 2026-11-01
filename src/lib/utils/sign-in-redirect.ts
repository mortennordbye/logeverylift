/**
 * Where the login form sends the browser after a successful sign-in, or null
 * when it must not navigate at all.
 *
 * Mid OAuth flow (an MCP client connecting), the server answers the sign-in
 * with `{ redirect: true, url }` and the auth client is already navigating
 * there; a second navigation to `from` would cancel it and strand the user on
 * the home page instead of the consent screen.
 *
 * Otherwise `from` is followed only when it is a same-origin relative path.
 * Anything else (an absolute URL, protocol-relative "//evil.com", or
 * "/\evil.com") is an open-redirect / phishing pivot and is discarded in
 * favour of the home page.
 */
export function signInRedirect(data: unknown, from: string | null): string | null {
  if (data && typeof data === "object" && "redirect" in data && data.redirect) return null;
  const raw = from ?? "/";
  return raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\") ? raw : "/";
}
