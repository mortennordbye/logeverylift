#!/usr/bin/env bash
# Prepare the e2e database, build, and serve the standalone production server.
# Started by Playwright's webServer (playwright.config.ts), which passes the env.
#
# The standalone server rather than `next start`: with `output: "standalone"`,
# `next start` answers 404 on every route. This mirrors the Docker runner stage:
# static assets and public/ copied next to server.js, run from that directory,
# so it also does not pick up the repo's .env.local.
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm exec tsx scripts/e2e-prepare.ts
pnpm exec next build
rm -rf .next/standalone/.next/static .next/standalone/public
cp -R .next/static .next/standalone/.next/static
cp -R public .next/standalone/public
cd .next/standalone
exec node server.js
