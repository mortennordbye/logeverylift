#!/usr/bin/env bash
#
# Pre-push guard: if you changed src/db/schema/, you must commit a matching
# drizzle/<NNNN>_*.sql migration in the same push range. Prod's db:migrate
# only runs committed SQL — pushing a schema TS change without the migration
# breaks prod (column missing, query fails, page crashes).
#
# Compares the local push range against origin/main. Skipped if not on a
# branch (detached HEAD) or if origin/main is missing.

set -euo pipefail

# Resolve the upstream tracking branch, fall back to origin/main.
upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || echo "origin/main")

if ! git rev-parse --verify --quiet "$upstream" >/dev/null; then
  exit 0  # nothing to compare against
fi

range="$upstream..HEAD"
changed=$(git diff --name-only "$range" 2>/dev/null || true)

if [ -z "$changed" ]; then
  exit 0
fi

schema_changed=$(echo "$changed" | grep -E '^src/db/schema/' || true)
migration_added=$(echo "$changed" | grep -E '^drizzle/[0-9]{4}_.*\.sql$' || true)

if [ -n "$schema_changed" ] && [ -z "$migration_added" ]; then
  cat <<EOF >&2

✗ Schema change detected without a matching migration file.

Changed under src/db/schema/:
$(echo "$schema_changed" | sed 's/^/  /')

But no drizzle/NNNN_*.sql was added in this push range ($range).

Prod's db:migrate runs ONLY committed SQL files. Pushing a schema TS change
without the migration leaves prod's DB out of sync — queries against the new
column will fail at runtime.

Fix:
  pnpm db:generate          # writes drizzle/<next>_*.sql + meta snapshot
  git add drizzle/
  git commit -m "migration: <describe schema change>"
  git push

If you genuinely have a schema change that needs no migration (rare —
type-only refactor, comment update), bypass with:
  git push --no-verify

EOF
  exit 1
fi

exit 0
