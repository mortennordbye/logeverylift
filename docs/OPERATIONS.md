# Operations runbook

Living doc for prod ops. Add to it when you do something the next on-call won't remember.

## Health probes

- `GET /api/health` — liveness, no DB. Use as Kubernetes `livenessProbe`.
- `GET /api/ready` — readiness, hits DB with 5s timeout. Use as `readinessProbe`. Returns 503 when DB is unreachable so the load balancer drops the pod.

The Dockerfile `HEALTHCHECK` polls `/api/health` every 30s.

## Boot order

1. Container starts (`/app/entrypoint.sh`).
2. Migrations run via `tsx scripts/migrate.ts`. Idempotent — safe on every boot.
3. **If `SEED_ON_BOOT=true`**, `scripts/seed.ts` runs. Otherwise skipped. Do **not** enable on a populated prod DB.
4. `node server.js` starts Next.js.
5. `instrumentation.ts.register()` runs:
   - Validates env vars via `src/lib/env.ts` (Zod). Boot fails here on bad config.
   - Registers SIGTERM/SIGINT handlers that drain the pg `Pool`.
   - Auto-creates admin if `ADMIN_EMAIL`/`ADMIN_PASSWORD` are set and account doesn't exist.

## Required env

Listed in `.env.example`. `src/lib/env.ts` is the source of truth and will refuse to boot if any required var is missing. To add a new var: extend the schema in `src/lib/env.ts`, document it in `.env.example`, and update infrastructure config.

`SKIP_ENV_VALIDATION=true` bypasses the schema (used during `next build` only — at runtime we always validate).

## Rate limits (in-memory)

`src/lib/rate-limit.ts` — single-instance only. If we go horizontal, swap the `Map` for Redis; the API stays the same.

| Endpoint | Limit |
|---|---|
| `POST /api/auth/sign-in/*` | 10 / 15 min per IP |
| `POST /api/auth/sign-up/*` | 5 / hour per IP |
| `POST /api/auth/forget-password`, `reset-password` | 5 / hour per IP |
| `validateInviteToken()` | 30 / 15 min per IP |
| `registerWithToken()` | 5 / hour per IP |

Limits reset on container restart — known limitation of in-memory.

## Database

- Postgres connection pool in `src/db/index.ts`: `max=20`, `idleTimeoutMillis=30s`, `connectionTimeoutMillis=5s`.
- On SIGTERM, `pool.end()` runs in `instrumentation.ts` so K8s rolling deploys don't drop in-flight queries.
- Migrations live in `drizzle/`. All `CREATE TYPE` must be wrapped in `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL; END $$` — see `drizzle/0000_quick_rhodey.sql` and CLAUDE.md.

### Backup & restore (TODO — fill in for your provider)

The provider's automated backups are the primary recovery mechanism. Fill in the actual details:

- **Provider**: _(e.g. Neon / Supabase / managed RDS / self-hosted)_
- **Backup cadence**: _(e.g. continuous WAL with daily snapshots; retention 7 days)_
- **PITR window**: _(e.g. 7 days)_
- **Restore procedure**: _link to provider runbook or document inline_
- **Last tested restore**: _date — re-test at least quarterly_

Do **not** treat the Docker `postgres_data` volume in `docker-compose.yml` as a backup — that volume is dev-only.

## CI/CD

- `.github/workflows/ci.yml` runs `pnpm verify` (typecheck + Vitest) on every PR and on push to `main`.
- `.github/workflows/docker-publish.yml` builds and pushes the Docker image to GHCR on `main` push and `v*` tags.
- Lint is intentionally **not** in CI yet — pre-existing errors need a deliberate cleanup pass first (see CLAUDE.md).

## Observability

- **Error aggregation:** Sentry is wired in (`@sentry/nextjs`). It activates only when `SENTRY_DSN` is set (server) and/or `NEXT_PUBLIC_SENTRY_DSN` (browser). Without DSNs, the SDK is fully no-op — dev stays clean.
  - Server config: `sentry.server.config.ts`. Edge config: `sentry.edge.config.ts`. Client init: `instrumentation-client.ts`.
  - `instrumentation.ts` exports `onRequestError = Sentry.captureRequestError` so uncaught Server Component / route handler errors flow into Sentry automatically.
  - `error.tsx` and `global-error.tsx` also `Sentry.captureException(error)` to catch client-side React errors.
  - To wire source maps, add `SENTRY_AUTH_TOKEN` to CI and wrap `next.config.ts` with `withSentryConfig`. Currently skipped — runtime SDK works without it.
- **Console logging:** Tag pattern is `[actionName] short_tag`. Grep container logs with `docker-compose logs app | grep -E '\[\w+\]'`.
- **Metrics export:** Not configured. Add when latency or error rate becomes a question worth answering.

## Test coverage

`pnpm test:coverage` runs Vitest with v8 coverage. CI uploads `coverage/` as an artifact (14-day retention) on every PR. No threshold gate yet — current baseline is ~9% line coverage, dominated by untested action files. The unit tests focus on pure utilities; mutation paths are covered by Playwright e2e.

## Rotating secrets

`BETTER_AUTH_SECRET` rotation invalidates all sessions (users get logged out). Communicate before rotating in prod.

To rotate:
1. Generate: `openssl rand -base64 32`
2. Update the prod env / secret manager.
3. Restart pods.
4. All cookies become invalid; users sign in again.
