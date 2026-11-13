import { db } from "@/db";
import {
  accounts,
  jwks,
  oauthAccessTokens,
  oauthClientAssertions,
  oauthClientResources,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
  oauthResources,
  sessions,
  users,
  verifications,
} from "@/db/schema";
import { handOverSharedCustomExercises } from "@/lib/account-data";
import { consentRecord, termsConsentSchema } from "@/lib/consent";
import { DEMO_USER_EMAIL } from "@/lib/constants/demo";
import { env, trustedOrigins } from "@/lib/env";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, jwt } from "better-auth/plugins";
import { mcp } from "@better-auth/mcp";
import { MCP_SCOPES } from "@/lib/mcp/scopes";

/** The MCP endpoint's URL: the audience its access tokens are bound to. */
export const MCP_RESOURCE = `${env.BETTER_AUTH_URL}/api/mcp`;

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
      jwks,
      oauthClient: oauthClients,
      oauthResource: oauthResources,
      oauthClientResource: oauthClientResources,
      oauthRefreshToken: oauthRefreshTokens,
      oauthAccessToken: oauthAccessTokens,
      oauthConsent: oauthConsents,
      oauthClientAssertion: oauthClientAssertions,
    },
  }),
  emailAndPassword: {
    // Open self-signup through POST /api/auth/sign-up/email, rate limited per
    // IP in src/app/api/auth/[...all]/route.ts. The admin plugin marks `role`
    // as non-input, so a signup cannot ask for admin.
    enabled: true,
  },
  user: {
    additionalFields: {
      // Written server-side only (registerWithToken, admin createUser);
      // input: false keeps a public sign-up from claiming an inviter.
      invitedById: { type: "string", required: false, input: false },
      // The consent record (src/lib/consent.ts). Declared so the sign-up hook
      // below can write it with the new user; input: false refuses it from
      // the client, which sends the ticked boxes as `consent` instead.
      termsVersion: { type: "string", required: false, input: false, returned: false },
      policySeenVersion: { type: "string", required: false, input: false, returned: false },
      termsAcceptedAt: { type: "date", required: false, input: false, returned: false },
      healthConsentAt: { type: "date", required: false, input: false, returned: false },
    },
    // Self-service deletion from Account (POST /api/auth/delete-user). The
    // client sends the password, which Better Auth checks.
    deleteUser: {
      enabled: true,
      beforeDelete: async (user) => {
        // Admins impersonate the demo account; it is not anyone's to delete.
        if (user.email === DEMO_USER_EMAIL) {
          throw new APIError("FORBIDDEN", { message: "The demo account can't be deleted" });
        }
      },
    },
  },
  databaseHooks: {
    user: {
      // Open sign-up stores the consent the form collected in the same insert
      // as the account. Recorded in a request after sign-up, it could fail or
      // be cut off unseen, and home then asked a user who had just ticked both
      // boxes to accept again. Without a valid `consent`, the account is
      // created without it and home asks for it (src/app/consent).
      //
      // Admin create-user passes its `data` straight to the insert. Only the
      // server's own call, registerWithToken, may record consent through it
      // (it has no request or headers); an admin must not give consent on
      // someone else's behalf.
      create: {
        before: async (user, ctx) => {
          if (ctx?.path === "/admin/create-user" && (ctx.request || ctx.headers)) {
            return {
              data: { ...user, termsVersion: null, policySeenVersion: null, termsAcceptedAt: null, healthConsentAt: null },
            };
          }
          if (ctx?.path !== "/sign-up/email") return;
          const consent = termsConsentSchema.safeParse((ctx.body as { consent?: unknown } | undefined)?.consent);
          if (!consent.success) return;
          return { data: { ...user, ...consentRecord() } };
        },
      },
      // Runs for both self-deletion and admin removeUser.
      delete: { before: async (user) => handOverSharedCustomExercises(user.id) },
    },
  },
  session: {
    // 30 days — refreshed on each request so active users stay logged in
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24, // refresh session cookie daily
    cookieCache: {
      // Cache session data in an encrypted cookie for 5 minutes.
      // Skips the DB session-validation query on repeat page loads within that window.
      enabled: true,
      maxAge: 5 * 60,
    },
  },
  plugins: [
    admin({
      defaultRole: "user",
      adminRole: ["admin"],
    }),
    // Signs the MCP access tokens; requireMcpAuth checks them against its JWKS.
    jwt(),
    // OAuth provider for the MCP server (src/app/api/[transport]). MCP clients
    // register themselves, send the user through /login and /oauth/consent, and
    // get a token bound to MCP_RESOURCE. Tables: see src/db/schema/auth.ts.
    mcp({
      loginPage: "/login",
      consentPage: "/oauth/consent",
      resource: MCP_RESOURCE,
      // The provider's defaults plus the two MCP access levels the user picks
      // from on the consent page (src/lib/mcp/scopes.ts). Clients registered
      // before these existed got them in a data migration (drizzle/0080_mcp_scopes.sql).
      scopes: ["openid", "profile", "email", "offline_access", ...MCP_SCOPES],
      // MCP clients register without a session (RFC 7591), as they did on the
      // 1.6 plugin. Access still needs the user's login and consent.
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      // Desktop clients (Claude Code, Cursor) register a loopback callback
      // without saying they are native; "web" would reject it.
      clientRegistrationDefaultApplicationType: "infer",
    }),
  ],
  // The jwt plugin's GET /token hands a session a JWT; nothing here needs it.
  disabledPaths: ["/token"],
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: trustedOrigins(),
});

export type Session = typeof auth.$Infer.Session;
