# ==================================
# Multi-stage Dockerfile for Next.js
# ==================================

# Stage 1: Install dependencies
FROM node:25-alpine AS deps
# Pinned to the major CI installs (.github/workflows/ci.yml, pnpm/action-setup).
# Unpinned, this pulled whatever pnpm was newest at build time, and pnpm 11 turned
# ERR_PNPM_IGNORED_BUILDS from a warning into a hard failure — so `pnpm install`
# started failing here and in the image CI pushes, with no change to this repo.
# Keep it pinned, and keep it matching CI: an image built by a different package
# manager than the one the tests ran under is not the thing that was tested.
RUN npm install -g pnpm@10
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
# In dev, we don't use --frozen-lockfile to allow adding packages easily
RUN pnpm install

# ============================================================
# NEW Stage 2: Development (Fast Local Building)
# ============================================================
FROM node:25-alpine AS dev
RUN npm install -g pnpm@10 tsx
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
FROM node:25-alpine AS builder
RUN npm install -g pnpm@10
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
FROM node:25-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Nothing runs npm at runtime; left in, its bundled tar, sigstore and pacote ship as CVEs.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
# node:20-alpine is past end of life and no longer rebuilt, so take Alpine's fixes here.
RUN apk upgrade --no-cache

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