# ==================================
# Multi-stage Dockerfile for Next.js
# ==================================

# Stage 1: Install dependencies
FROM node:24-alpine AS deps
# Pinned to the exact version in package.json's `packageManager`, which is what
# CI's pnpm/action-setup reads. Unpinned, this pulled whatever pnpm was newest at
# build time, and a new major once broke `pnpm install` here with no change to
# this repo. An image built by a different package manager than the one the
# tests ran under is not the thing that was tested. Every `allowBuilds` entry in
# pnpm-workspace.yaml is false, so no dependency runs an install script.
RUN npm install -g pnpm@11.28.9
WORKDIR /app
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
# In dev, we don't use --frozen-lockfile to allow adding packages easily
RUN pnpm install

# ============================================================
# NEW Stage 2: Development (Fast Local Building)
# ============================================================
FROM node:24-alpine AS dev
RUN npm install -g pnpm@11.28.9 tsx
WORKDIR /app

# Copy node_modules from deps stage
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
# Stage 3: Build application (Production only)
# ============================================================
FROM node:24-alpine AS builder
RUN npm install -g pnpm@11.28.9
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV DATABASE_URL=postgresql://placeholder:placeholder@placeholder:5432/placeholder
ENV SERWIST_SUPPRESS_TURBOPACK_WARNING=1
RUN pnpm build
# Bundled so the runner needs no node_modules of its own: a `pnpm install --prod`
# still pulls drizzle-kit, vitest and vite in as better-auth's optional peers.
RUN pnpm exec esbuild scripts/migrate.ts scripts/seed.ts --bundle --platform=node \
    --target=node20 --format=cjs --external:pg-native --outdir=scripts-dist

# ============================================================
# Stage 4: Production runner
# ============================================================
FROM node:24-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Nothing runs npm at runtime; left in, its bundled tar, sigstore and pacote ship as CVEs.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# --chown at copy time: a later `RUN chown -R` would re-write every file into
# a new layer and double the image size.
COPY --chown=nextjs:nodejs --from=builder /app/public ./public
COPY --chown=nextjs:nodejs --from=builder /app/.next/standalone ./
COPY --chown=nextjs:nodejs --from=builder /app/.next/static ./.next/static
COPY --chown=nextjs:nodejs --from=builder /app/package.json ./
COPY --chown=nextjs:nodejs --from=builder /app/drizzle ./drizzle
COPY --chown=nextjs:nodejs --from=builder /app/scripts-dist ./scripts

# Entrypoint script
# Seed only runs when SEED_ON_BOOT=true. The production image must NOT seed by
# default — re-running seed against a populated DB risks duplicating data.
# Seed once into a fresh environment via `SEED_ON_BOOT=true` then unset it.
RUN echo '#!/bin/sh' > /app/entrypoint.sh && \
    echo 'set -e' >> /app/entrypoint.sh && \
    echo 'echo "🔄 Running database migrations..."' >> /app/entrypoint.sh && \
    echo 'node /app/scripts/migrate.js' >> /app/entrypoint.sh && \
    echo 'if [ "$SEED_ON_BOOT" = "true" ]; then' >> /app/entrypoint.sh && \
    echo '  echo "🌱 Seeding database..."' >> /app/entrypoint.sh && \
    echo '  node /app/scripts/seed.js' >> /app/entrypoint.sh && \
    echo 'fi' >> /app/entrypoint.sh && \
    echo 'echo "🚀 Starting application..."' >> /app/entrypoint.sh && \
    echo 'exec node server.js' >> /app/entrypoint.sh && \
    chmod +x /app/entrypoint.sh

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]