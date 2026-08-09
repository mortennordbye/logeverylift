#!/bin/sh
# Production container entrypoint. Previously this was built up with a chain of
# `echo >> entrypoint.sh` lines inside the Dockerfile, which made it invisible to
# shellcheck and impossible to diff. It is a real file now.
set -e

echo "🔄 Running database migrations..."
./node_modules/.bin/tsx /app/scripts/migrate.ts

# Seeding is destructive on a populated database. It runs only when explicitly
# asked for — once, into a fresh environment — and SEED_ON_BOOT should be unset
# again afterwards.
if [ "$SEED_ON_BOOT" = "true" ]; then
  echo "🌱 Seeding database..."
  ./node_modules/.bin/tsx /app/scripts/seed.ts
fi

echo "🚀 Starting application..."
exec node server.js
