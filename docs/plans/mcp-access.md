# MCP access: scopes, consent, revoke, instructions and resources

> **Status:** building. Packages **B2** and **B3** of [`triathlon-coach-plan.md`](triathlon-coach-plan.md).
> **Written:** 2026-11-12. One PR, branch `feat/mcp-access-b2-b3`.

Written to be picked up with no conversation history. Read `CLAUDE.md`, `TESTING.md`, the plan
(sections 1-3 and 6) and decisions D5, D6 and T1 in
[`docs/triathlon-coach-audit.md`](../triathlon-coach-audit.md) first.

## 0. Goal

- **B2 (D5, D6).** The user picks read-only or read and write when they connect an assistant.
  Every MCP tool obeys that choice. The consent page says plainly what the assistant can read.
  A screen in the app lists connected assistants and disconnects them at once.
- **B3 (T1).** The MCP server tells the model how the app works and how a weekly review goes
  (server instructions). It serves the endurance research and the app's rules as versioned MCP
  resources, and both ship in the production image.

For everyone, not behind the endurance switch (D18). No change to any lifter flow.

## 1. Findings in the code

### Scopes and tokens

- The OAuth provider is `mcp()` from `@better-auth/mcp` 1.7.17 (`src/lib/auth.ts:97-108`). It
  sets no `scopes`, so the provider uses its default list (`openid profile email
  offline_access`). Nothing app-specific exists, so every token can do everything.
- `requireMcpAuth` is called with only the resource (`src/app/api/[transport]/route.ts:72`). The
  handler reads only `claims.sub` (`src/app/api/[transport]/route.ts:32`) and registers every
  tool for that user (`src/app/api/[transport]/route.ts:59-68`).
- Access tokens are JWTs bound to `MCP_RESOURCE`. The provider's own revoke endpoint refuses them:
  "JWT access tokens are self-contained and cannot be revoked server-side" (in
  `@better-auth/oauth-provider` 1.7.17). So deleting a consent or a refresh token leaves the
  current access token working until it expires (1 hour by default). An instant revoke needs a
  check of our own on each MCP request.
- Token claims carry `scope` (space separated) and `azp` (the client id). `requireMcpAuth`
  requires `azp`.
- Scope rules in the provider, read from its source:
  - Authorize: requested scopes must be inside the client's registered `scopes`, or the request
    fails with `invalid_scope`. With no `scope` in the request, it uses the client's registered
    list.
  - Consent: `POST /oauth2/consent` takes an optional `scope`, which must be a subset of the
    scopes the client asked for. So the consent page can narrow a request, never widen it.
  - New clients that register themselves get the provider option clientRegistrationDefaultScopes, which defaults
    to `scopes`. Clients already in `oauth_client` keep the list they were saved with.
- Scopes are stored on `oauth_consent.scopes` (`src/db/schema/auth.ts:226`), on refresh tokens
  (`src/db/schema/auth.ts:175`) and on opaque access tokens (`src/db/schema/auth.ts:204`).
- The provider's `get-consents` and `delete-consent` endpoints exist, but delete removes only the
  consent row. It does not touch tokens.

### Tools

- 22 tools in five modules. Each sets `annotations`; read tools set `readOnlyHint: true`
  (`src/lib/mcp/tools/cycles.ts:43`, `src/lib/mcp/tools/workouts.ts:29`,
  `src/lib/mcp/tools/garmin.ts:30`, `src/lib/mcp/tools/programs.ts:128`,
  `src/lib/mcp/tools/profile.ts:27`). The eight write tools do not
  (`src/lib/mcp/tools/programs.ts:179`, `src/lib/mcp/tools/programs.ts:202`,
  `src/lib/mcp/tools/programs.ts:225`, `src/lib/mcp/tools/programs.ts:255`,
  `src/lib/mcp/tools/cycles.ts:94`, `src/lib/mcp/tools/cycles.ts:232`,
  `src/lib/mcp/tools/profile.ts:72`, `src/lib/mcp/tools/profile.ts:137`).
- Workout tools leave notes out on purpose (`src/lib/mcp/tools/workouts.ts:10-11`). Package B1
  adds note reads (D6). This brief only names notes in the consent and the policy.
- Tests: a unit test checks registration with a stub server (`src/__tests__/mcp-tools.test.ts`);
  one integration test calls the workout tools with real SQL through a stub
  `registerTool` (`src/__tests__/integration/mcp-workouts.test.ts:14-27`). No write tool has an
  integration test.

### Consent, revoke and privacy

- The consent page says the assistant "will be able to read and change your programs, training
  cycles, profile and body weight" (`src/app/oauth/consent/page.tsx:41-42`). It does not name
  workout history or Garmin, which the tools already read.
- The form posts `authClient.oauth2.consent({ accept })` with no scope
  (`src/components/features/OAuthConsentForm.tsx:18`).
- No screen lists connections, though the policy says "You can disconnect at any time"
  (`src/app/privacy/page.tsx:160-163`).
- Inventory: the MCP storage row (`docs/privacy/data-inventory.md:27`) and the recipient row,
  which says "without free-text notes" (`docs/privacy/data-inventory.md:53`).
- Export already covers all five OAuth tables, with secrets left out
  (`src/lib/account-data.ts:150-167`). Account deletion cascades them.
- `LEGAL_VERSION` is `2026-11-05` and `CONSENT_VERSION` is `2026-10-25`
  (`src/lib/constants/legal.ts:7`, `src/lib/constants/legal.ts:16`). The rule in that file and
  in the `privacy-compliance` skill: a new recipient is told (bump `LEGAL_VERSION`), not asked
  (leave `CONSENT_VERSION`). Notes are already listed as health data
  (`docs/privacy/data-inventory.md:31`).

### Instructions, resources and the image

- `createMcpHandler` gets `{}` as server options (`src/app/api/[transport]/route.ts:67`), so
  there are no instructions and no resources.
- The Docker builder copies the whole repo (`Dockerfile:47`), but the runner copies only
  `public`, the standalone build, static files, `package.json`, `drizzle` and `scripts-dist`
  (`Dockerfile:73-78`). `docs/` is not in the image.
- The e2e suite serves the standalone build from `.next/standalone`, as the runner stage does
  (`scripts/e2e-serve.sh:11-18`), and `e2e/mcp-oauth.spec.ts` already runs the full OAuth flow
  against it and calls `tools/list` with the token (`e2e/mcp-oauth.spec.ts:120-125`). It asks for
  `scope: "openid offline_access"` (`e2e/mcp-oauth.spec.ts:65`).

## 2. Design

### 2.1 Scopes (B2)

Two new scopes: `mcp:read` and `mcp:write`.

| Choice on the consent page | Granted scopes | What works |
|---|---|---|
| Read only | `mcp:read` | Every tool with `readOnlyHint: true`, and the resources |
| Read and change | `mcp:read mcp:write` | Everything |

- Add both to `scopes` in the `mcp()` options, next to the four defaults, so they show in the
  authorization-server and protected-resource metadata (`scopes_supported`). Set
  the challengeScopes option of `requireMcpAuth` to both, so the 401 challenge tells clients to ask for
  them (MCP clients take the challenge scope first, then `scopes_supported`).
- **Effective scopes** for a request are the token's `scope` claim intersected with the scopes on
  the user's live consent for that client (`oauth_consent` where `client_id = azp` and
  `user_id = sub`). One indexed query per request.
  - No consent row: refuse with 401, so the client starts the OAuth flow again. This is what
    makes revoke instant (section 1: JWTs cannot be revoked).
  - Neither `mcp:read` nor `mcp:write`: refuse with 403 `insufficient_scope` naming
    `mcp:read mcp:write`, so a client can step up. This covers old tokens and clients that ask
    only for `openid`.
  - The consent row can only narrow the token. To change access, the user disconnects, then
    connects again (the text of the read-only refusal says so). Reconnecting without a
    disconnect does not offer the choice: the provider skips the consent page when the stored
    consent already covers the requested scopes. The other way round, a read-only user sees
    the consent page on every new authorization, because the client asks for `mcp:write`,
    which the stored consent lacks.
- **Enforcement on every tool.** A new module `src/lib/mcp/scopes.ts` wraps the `McpServer`
  passed to the five `register*Tools` functions. Its `registerTool` reads the tool's
  annotations: `readOnlyHint: true` is a read tool, anything else is a write tool (fails
  closed: a new tool with no hint needs write). Under read-only, a write tool stays listed, but
  its handler returns an error result without running the original: "This connection is
  read-only. To let the assistant make changes, disconnect it in LogEveryLift (More → Connected
  assistants) and connect again with read and change access." The model then knows why and can
  tell the user.
  - This needs no change inside the tool bodies, which keeps clear of the A1 work in
    `src/lib/mcp/tools/programs.ts`. In `route.ts` the change is the wiring: the per-request
    consent lookup, the 401 and 403 answers, passing the wrapped server to the tool modules,
    the instructions and the resources.
  - Any other registration method (`tool`, `prompt`, `registerPrompt`, `resource`,
    `registerResource`) throws on the read-only wrapper, so nothing reaches the client
    unchecked. Resources are registered on the unwrapped server.
  - Write tools in read-only also get " (needs read and change access)" added to their
    description, so the model does not plan with them.
- **Consent page.** Shows the two choices as large radio rows (44 px+), read only selected by
  default. "Allow" calls `authClient.oauth2.consent({ accept: true, scope })` with the original
  request's scopes, minus `mcp:write` for read only. If the client did not ask for `mcp:write`,
  only read only shows. If it asked for no `mcp:*` scope at all, the page says the assistant
  asked for no LogEveryLift access and Allow stays (it gets 403 later, as today's spec tokens
  would). The page reads the requested scopes from the signed query, which it already verifies
  (`src/app/oauth/consent/page.tsx:28`).
- **Consent text** (all users, both choices):
  > It will be able to read your profile and body weight, your programs and training cycles,
  > and your workout history: sets, weights, heart rate zones, effort, how you felt, your
  > readiness, and the notes you write on workouts and sets. [If Garmin is on:] It can also
  > read data from your Garmin account (readiness, sleep, heart rate, training load and
  > activities). With read and change access it can also change your profile, body weight,
  > programs and cycles. Changes apply at once.

  The illness log line is added by package C5 when the log exists. Notes are named now, ahead
  of B1, so B1 needs no consent change (owner decision 3).

### 2.2 Connected assistants screen (B2)

- Route `/more/assistants`, a row "Connected assistants" in the Account group of More.
- Server Component lists the user's `oauth_consent` rows joined to `oauth_client` for the name,
  with: assistant name (or "Unnamed assistant"), access (read only or read and change) and
  connected date (`created_at`), newest first. Empty state: "No assistants
  connected." with one line on how to connect.
- "Disconnect" opens a confirm sheet, then calls a new Server Action `disconnectAssistant({ id })`
  (canonical template, through `callAction()`). In one transaction, filtered by
  `user_id = auth.user.id`: delete the consent row, set `revoked` on the user's refresh tokens
  and opaque access tokens for that client. The JWT in the client's hands then fails the
  per-request consent check (2.1). `oauth_client` rows stay: dynamically registered clients have
  no owner (`user_id` is null for them), and other users may share one.
- Switching access level: no edit control. Disconnect and connect again. Keeps one path.

### 2.3 Server instructions (B3)

Decision for this brief: **describe only what exists today, with a clear extension point.**
Describing features that are "coming" invites the model to look for tools that are not there.

- New module `src/lib/mcp/instructions.ts` builds the text from named sections. Each later
  package adds or changes its own section in the same PR as its tools (A3 endurance switch, A4
  revisions, B1 field owners in tool descriptions, B4 coach memory, C1 seasons, C2 dated
  sessions, D2 limits). The module header lists this rule.
- Sections today, in short sentences, under about 60 lines in all:
  1. **What the app is.** Strength-first training log; programs (exercises with planned sets),
     training cycles (a weekly or rotation template of slots pointing at programs, with a
     periodization curve and a weekly sync), logged workout sessions with sets.
  2. **Who owns which field** (audit section 8 as the code is today): the progression engine
     owns `target_reps` and `weight_kg` on strength sets; the weekly sync owns distance and
     duration on sets with a peak anchor and zone and rest on `work` sets. An edit to those is
     a one-off that the next session or sync can change.
  3. **What does not exist yet**, said plainly: no undo or revision history, so every write is
     final and the model must say what it changed; no training-limit checks in code; one
     session per day; no seasons; times are in the server's time zone; all values are metric.
     Each item names the package that will change it, for the maintainer, not the model.
  4. **Access.** Read-only connections refuse write tools; ask the user to reconnect.
  5. **Weekly review.** Read profile, the active cycle, recent workouts, weekly volume, records
     and (if present) Garmin trends; compare the week with the plan; report what went well,
     what was missed and any warning sign, citing the rules resource and the research resource
     with their evidence labels; propose changes; apply only what the user asks for (D1 says
     changes apply at once, the plan says the coach adapts only on request); after each write,
     report what changed and why.
  6. **Resources.** Names the two resources and when to read them.
- The text is passed as `instructions` in the server options of `createMcpHandler`.

### 2.4 Resources (B3)

| URI | Source | Title |
|---|---|---|
| `logeverylift://docs/endurance-training-reference` | `docs/research/endurance-training-reference.md` | Endurance training reference |
| `logeverylift://docs/app-rules` | `docs/mcp/app-rules.md` (new) | LogEveryLift rules for assistants |

- **App rules** is a new doc: the data model in more depth than the instructions, field owners
  with `file:line` citations (so `pnpm check:docs` keeps them honest), units and time, and the
  "does not exist yet" list. It is the long form; the instructions are the summary. It holds no
  personal data.
- **Version.** Each resource carries `<date>+<hash>`: the date the doc states at its top
  (`Research done 2026-11-12` in the research doc; a `Version:` line in the rules doc) and the
  first 12 hex characters of the SHA-256 of the file. It goes in the resource `_meta.version`,
  in the description, and in a first line of the text returned. The hash changes with any edit,
  so a stale copy is visible; the date says when the content was last reviewed.
- MIME type `text/markdown`. The research file's first line (an HTML comment that opts it out of the doc-claims check) is
  stripped before serving.
- Read lazily from disk on `resources/read` and cached in module memory per process. A missing
  file returns an MCP error and logs `[mcp:resource] missing` with the URI.
- **Getting the files into the image:** add `outputFileTracingIncludes` in `next.config.ts` for
  the route `/api/[transport]`, listing both doc paths. Next's file tracing then copies them into
  `.next/standalone/docs/...`, which the runner already copies (`Dockerfile:74`). The loader
  reads `path.join(process.cwd(), <doc path>)`; the standalone server runs from its own
  directory, as `scripts/e2e-serve.sh` and the Dockerfile do. One list of paths in
  `src/lib/mcp/resources.ts` is the source; `next.config.ts` imports it, so the two cannot
  drift. No Dockerfile change. Checked in the build: Turbopack copies both files to
  `.next/standalone/docs/`.
- Resources are readable under both scopes. They hold no user data.

## 3. Data model and migration

No schema change. One custom data migration (`pnpm drizzle-kit generate --custom --name
mcp_scopes`), SQL plus `drizzle/meta` journal:

```sql
-- Let existing clients request the new scopes (authorize checks them against this list).
UPDATE "oauth_client" SET "scopes" = array_cat("scopes", ARRAY['mcp:read','mcp:write'])
  WHERE "scopes" IS NOT NULL AND NOT ('mcp:read' = ANY("scopes"));
-- Old connections were approved under the old consent text and hold no mcp scope.
UPDATE "oauth_refresh_token" SET "revoked" = now()
  WHERE "revoked" IS NULL AND NOT ('mcp:read' = ANY("scopes"));
DELETE FROM "oauth_consent" WHERE NOT ('mcp:read' = ANY("scopes"));
```

The last two statements follow owner decision 1. All three are idempotent.

**Existing connections after the migration (owner decision 1):** they get no
scope. Their access tokens fail the consent check (401), their refresh tokens are revoked, and
the assistant must connect again through the new consent page, where the user picks read only
or read and change. The owner's own Claude connector needs one reconnect.

**Rollback.** A code rollback alone is not safe. The old route has no scope check, so every
read-only connection could write again. Run this data step together with a code rollback; it
ends the read-only connections, and the users connect again:

```sql
UPDATE "oauth_refresh_token" SET "revoked" = now()
  WHERE "revoked" IS NULL AND NOT ('mcp:write' = ANY("scopes"));
DELETE FROM "oauth_consent" WHERE NOT ('mcp:write' = ANY("scopes"));
```

Access tokens are JWTs and cannot be revoked, and the old route does not check the consent, so a
read-only connection's current token can still write until it expires (1 hour by default). The
extra scopes on `oauth_client` do no harm to the old code. To undo them as well:
`UPDATE "oauth_client" SET "scopes" = array_remove(array_remove("scopes", 'mcp:read'), 'mcp:write');`.
Deleted consents and revoked refresh tokens cannot be brought back; users reconnect. No training
data is touched.

## 4. MCP tools

No new tools. Every existing tool gets scope enforcement through the wrapper (2.1). New: two
resources and the server instructions.

## 5. Field owners

| Field | Owner |
|---|---|
| `oauth_consent.scopes` | The user, on the consent page (written by the provider) |
| `oauth_consent` row lifetime | The user (connect, disconnect) and the migration |
| `oauth_refresh_token.revoked`, `oauth_access_token.revoked` | The provider, and the disconnect action |
| Resource text | The source docs; edited only in git |

## 6. Privacy steps (`privacy-compliance` skill)

1. Inventory, edit first:
   - Storage row (`docs/privacy/data-inventory.md:27`): add that each connection stores its
     access level, and that disconnect in the app deletes the consent and revokes tokens.
   - Recipient row (`docs/privacy/data-inventory.md:53`): read only or read and change, chosen
     per connection; reads include workout notes (from package B1); Garmin reads as today; no
     user data in the resources.
2. Policy (`src/app/privacy/page.tsx:160-163`): same facts in plain words; disconnect at any
   time in More → Connected assistants.
3. Consent page text as in 2.1.
4. Bump `LEGAL_VERSION` to the merge date. `CONSENT_VERSION` stays (owner decision 2).
5. Export: no new tables; the five OAuth tables are already exported. Delete: unchanged
   (cascade). Logs: the disconnect action and the scope refusal log ids and tags only
   (`[disconnectAssistant]`, `[mcp:scope] refused` with the tool name).
6. Friends: no change.

## 7. Tests per layer

| Layer | What | File |
|---|---|---|
| Unit | Tool classification: every registered tool is read or write by its annotation; the read list is exactly the 14 read tools; a tool with no hint is write | `src/__tests__/mcp-tools.test.ts` |
| Unit | Effective scopes: token ∩ consent; missing consent; no mcp scope; read only drops write | `src/__tests__/mcp-scopes.test.ts` |
| Unit | Instructions mention every registered tool group and both resource URIs; resource version format and hash; doc-claims line stripped | `src/__tests__/mcp-resources.test.ts` |
| Unit | Consent form sends the narrowed scope for read only and the full one for read and change | `src/__tests__/components/oauth-consent-form.test.tsx` |
| Integration | **Every write tool** under read only: error result, no row changed. Every write tool under read and change: runs. Every read tool under read only: runs | `src/__tests__/integration/mcp-scopes.test.ts` |
| Integration | Per-request consent check against real `oauth_consent` rows: live, deleted, narrowed | same file |
| Integration | `disconnectAssistant`: deletes only the caller's consent, revokes the caller's tokens for that client, leaves another user's untouched, refuses another user's consent id | `src/__tests__/integration/mcp-assistants.test.ts` |
| Integration | Migration: an old client gains the scopes; old consents and refresh tokens are cleared; a new-style consent survives; running it twice is a no-op | `src/__tests__/integration/migrations.test.ts` |
| e2e | The e2e reset (`e2e/fixtures/reset.ts`) clears the account's consents, so the screen starts empty. Extend `e2e/mcp-oauth.spec.ts`: ask for the mcp scopes, pick read only, `tools/list` works, a write tool is refused, `resources/list` shows both, `resources/read` returns each with a version, then disconnect on the new screen and the same token gets 401. This runs against the standalone production build, so it is the test that each resource ships in the build. | `e2e/mcp-oauth.spec.ts` |

Not a critical flow in `CLAUDE.md` terms, so no smoke pass. CI runs e2e.

## 8. Order of work

1. Scopes in the provider, the migration, the per-request check, the wrapper; unit and
   integration tests.
2. Consent page and form; component test.
3. Connected assistants screen and action; integration test.
4. Instructions, rules doc, resources, tracing config; unit tests; e2e extension.
5. Inventory, policy, `LEGAL_VERSION`; `pnpm verify`.

## 9. Owner decisions (2026-11-12)

1. **Existing connections are cleared.** The migration revokes old refresh tokens and deletes
   old consents. Each assistant reconnects once through the new consent page.
2. **`LEGAL_VERSION` only.** `CONSENT_VERSION` stays. A new recipient of data that is already a
   listed health-data category is told, not asked (rule in `src/lib/constants/legal.ts`); the
   MCP consent page is the explicit consent for each connection. The plan's B2 text is fixed to
   match.
3. **Notes are named now** on the consent page and in the policy, so B1 needs no new text.

## 10. Defaults chosen (accepted by the owner, 2026-11-12)

- Scope names `mcp:read` and `mcp:write`; read and change grants both.
- Read only is the preselected choice on the consent page.
- Write tools stay listed under read only and refuse with a reason, rather than being hidden.
- Disconnect is instant (consent check on every request); changing access means disconnect and
  reconnect.
- Screen at More → Connected assistants (`/more/assistants`).
- Instructions describe today's app only; later packages extend them.
- Resource version is the doc's own date plus a content hash.
- Docs reach the image through Next file tracing, not a Dockerfile copy.

## 11. Cross-branch notes

- Package A3 (endurance switch) runs in parallel. When both are merged, the instructions get an
  "endurance switch" section in whichever PR lands second.
- Package A1 changes tool bodies in `src/lib/mcp/tools/programs.ts`; this PR changes no tool
  body. If A1 adds a tool, it must set `readOnlyHint` correctly, or the wrapper treats it as a
  write tool (safe default).
