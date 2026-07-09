# ==================================
# Multi-stage Dockerfile for Next.js
# ==================================

# Stage 1: Install dependencies
FROM node:20-alpine AS deps
RUN npm install -g pnpm
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
# In dev, we don't use --frozen-lockfile to allow adding packages easily
RUN pnpm install

# ============================================================
# NEW Stage 2: Development (Fast Local Building)
# ============================================================
FROM node:20-alpine AS dev
RUN npm install -g pnpm tsx
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
FROM node:20-alpine AS builder
RUN npm install -g pnpm
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV DATABASE_URL=postgresql://placeholder:placeholder@placeholder:5432/placeholder
ENV SERWIST_SUPPRESS_TURBOPACK_WARNING=1
RUN pnpm build

# ============================================================
# Stage 4: Production-only dependencies (for migrate/seed at boot)
# ============================================================
# The standalone server bundles its own runtime deps; this tree only serves
# the tsx entrypoint scripts (drizzle-orm, pg, zod are all prod deps). A
# prod-only install keeps typescript/eslint/vitest/playwright/drizzle-kit
# out of the image — smaller push to ghcr and faster pulls on deploy.
FROM node:20-alpine AS prod-deps
RUN npm install -g pnpm
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --prod --frozen-lockfile

# ============================================================
# Stage 5: Production runner
# ============================================================
FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install -g tsx

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

# Entrypoint script
# Seed only runs when SEED_ON_BOOT=true. The production image must NOT seed by
# default — re-running seed against a populated DB risks duplicating data.
# Seed once into a fresh environment via `SEED_ON_BOOT=true` then unset it.
RUN echo '#!/bin/sh' > /app/entrypoint.sh && \
    echo 'set -e' >> /app/entrypoint.sh && \
    echo 'echo "🔄 Running database migrations..."' >> /app/entrypoint.sh && \
    echo 'tsx /app/scripts/migrate.ts' >> /app/entrypoint.sh && \
    echo 'if [ "$SEED_ON_BOOT" = "true" ]; then' >> /app/entrypoint.sh && \
    echo '  echo "🌱 Seeding database..."' >> /app/entrypoint.sh && \
    echo '  tsx /app/scripts/seed.ts' >> /app/entrypoint.sh && \
    echo 'fi' >> /app/entrypoint.sh && \
    echo 'echo "🚀 Starting application..."' >> /app/entrypoint.sh && \
    echo 'exec node server.js' >> /app/entrypoint.sh && \
    chmod +x /app/entrypoint.sh

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]