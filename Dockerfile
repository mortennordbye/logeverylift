# ==================================
# Multi-stage Dockerfile for Next.js
# ==================================

# ============================================================
# Stage 0: Pinned base
# ============================================================
# The Node version and its digest are declared once here; every other stage
# derives from this or from `toolchain`. Dependabot's docker ecosystem bumps
# both the tag and the digest on this single line.
#
# node:26 is the Current line, not LTS — Node 26 enters LTS in October 2026.
# Until then it still gets security releases; the tradeoff is deliberate.
FROM node:26-alpine@sha256:aadf416b2cdce311a8811ba3f0608a61b77dbf997500e2eafe781b51f6a0b019 AS base
WORKDIR /app

# ============================================================
# Stage 1: Toolchain (base + pnpm)
# ============================================================
# pnpm is pinned to the same version as package.json's `packageManager`. They
# must not drift: pnpm 11 reads `overrides` and `allowBuilds` from
# pnpm-workspace.yaml, which pnpm 10 silently ignores — the install then either
# resolves the vulnerable transitive versions the overrides exist to prevent, or
# dies on ERR_PNPM_IGNORED_BUILDS.
FROM base AS toolchain
RUN npm install -g pnpm@11.21.0

# ============================================================
# Stage 2: Install dependencies
# ============================================================
FROM toolchain AS deps
# pnpm-workspace.yaml carries the security overrides and the build-script
# allowlist. Omitting it does not fail loudly — it produces a quietly different
# dependency tree from the one `pnpm audit` was run against.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# --frozen-lockfile everywhere, including the tree the production image is built
# from. Without it a stale lockfile is silently "fixed" during the build and the
# image ships dependencies nobody verified.
RUN pnpm install --frozen-lockfile

# ============================================================
# Stage 3: Development (fast local building)
# ============================================================
FROM toolchain AS dev
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=development
ENV NEXT_TELEMETRY_DISABLED=1
# Force bind to 0.0.0.0 for iPhone access
ENV HOSTNAME="0.0.0.0"

EXPOSE 3000

# Start Next.js with Turbopack for maximum speed
CMD ["pnpm", "next", "dev", "--turbo", "-H", "0.0.0.0"]

# ============================================================
# Stage 4: Build application (production only)
# ============================================================
FROM toolchain AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV DATABASE_URL=postgresql://placeholder:placeholder@placeholder:5432/placeholder
ENV SERWIST_SUPPRESS_TURBOPACK_WARNING=1
RUN pnpm build

# ============================================================
# Stage 5: Production-only dependencies (for migrate/seed at boot)
# ============================================================
# The standalone server bundles its own runtime deps; this tree only serves the
# tsx entrypoint scripts (tsx, drizzle-orm, pg and zod are all prod deps). A
# prod-only install keeps typescript/eslint/vitest/playwright/drizzle-kit out of
# the image — smaller push to ghcr and faster pulls on deploy.
FROM toolchain AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

# ============================================================
# Stage 6: Production runner
# ============================================================
# Derives from `base`, not `toolchain` — pnpm has no job at runtime and would
# just be dead weight in the shipped image.
FROM base AS runner
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# --chown at copy time: a later `RUN chown -R` would re-write every file into
# a new layer and double the image size.
COPY --chown=nextjs:nodejs --from=builder /app/public ./public
COPY --chown=nextjs:nodejs --from=builder /app/.next/standalone ./
COPY --chown=nextjs:nodejs --from=builder /app/.next/static ./.next/static
COPY --chown=nextjs:nodejs --from=builder /app/package.json ./
COPY --chown=nextjs:nodejs --from=prod-deps /app/node_modules ./node_modules
COPY --chown=nextjs:nodejs --from=builder /app/drizzle ./drizzle
COPY --chown=nextjs:nodejs --from=builder /app/scripts ./scripts
COPY --chown=nextjs:nodejs --from=builder /app/src/db ./src/db
COPY --chown=nextjs:nodejs --from=builder /app/src/lib ./src/lib

# Entrypoint script
# Seed only runs when SEED_ON_BOOT=true. The production image must NOT seed by
# default — re-running seed against a populated DB risks duplicating data.
# Seed once into a fresh environment via `SEED_ON_BOOT=true` then unset it.
#
# tsx comes from the prod node_modules rather than a global `npm install -g`:
# one pinned version resolved by the lockfile, one fewer network fetch at build
# time, and no drift between the image and package.json.
COPY --chown=nextjs:nodejs docker-entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
