<div align="center">

# LogEveryLift

### A mobile-first workout tracking PWA that feels like a native iOS app.

[![Next.js](https://img.shields.io/badge/Next.js-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org) [![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org) [![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org) [![Drizzle](https://img.shields.io/badge/Drizzle-C5F74F?logo=drizzle&logoColor=black)](https://orm.drizzle.team) [![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)

[![CI](https://github.com/mortennordbye/logeverylift/actions/workflows/ci.yml/badge.svg)](https://github.com/mortennordbye/logeverylift/actions/workflows/ci.yml) [![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/mortennordbye/logeverylift/badge)](https://securityscorecards.dev/viewer/?uri=github.com/mortennordbye/logeverylift)

[![License](https://img.shields.io/github/license/mortennordbye/logeverylift?style=flat-square)](LICENSE) [![Last Commit](https://img.shields.io/github/last-commit/mortennordbye/logeverylift?style=flat-square)](https://github.com/mortennordbye/logeverylift/commits/main) [![Stars](https://img.shields.io/github/stars/mortennordbye/logeverylift?style=flat-square)](https://github.com/mortennordbye/logeverylift/stargazers)

Built with Next.js 16 (App Router) and React Server Components. Runs in Docker containers for environment consistency.

</div>

---

## Screenshots

<table>
  <tr>
    <td align="center" width="33%">
      <img src="docs/screenshots/home.png" alt="Workout home screen — active training block, today's session, and weekly progress" width="240" /><br />
      <sub><b>Home</b> — active block & today's session</sub>
    </td>
    <td align="center" width="33%">
      <img src="docs/screenshots/exercise-detail.png" alt="Exercise detail — per-set targets, last-session history, progression hints, and rest timers" width="240" /><br />
      <sub><b>Exercise</b> — per-set targets & rest timers</sub>
    </td>
    <td align="center" width="33%">
      <img src="docs/screenshots/calendar.png" alt="Calendar — scheduled and completed sessions across training cycles" width="240" /><br />
      <sub><b>Calendar</b> — scheduled vs completed</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="33%">
      <img src="docs/screenshots/metrics.png" alt="Metrics — top lifts and per-exercise progression charts" width="240" /><br />
      <sub><b>Metrics</b> — top lifts & progression</sub>
    </td>
    <td align="center" width="33%">
      <img src="docs/screenshots/ai-setup.png" alt="AI Setup — generate programs and training schedule from a prompt" width="240" /><br />
      <sub><b>AI Setup</b> — generate programs from a prompt</sub>
    </td>
    <td align="center" width="33%">
      <img src="docs/screenshots/exercises.png" alt="Exercise library — browse by body area, muscle, equipment, and type, or add your own" width="240" /><br />
      <sub><b>Exercises</b> — browse the library or add your own</sub>
    </td>
  </tr>
</table>

---

## Quick Start

### Prerequisites
- Docker Desktop

### Start Development
```bash
make dev
```
- App: [http://localhost:3000](http://localhost:3000)
- Health: [http://localhost:3000/api/health](http://localhost:3000/api/health)

### Common Commands

```bash
# Database
make db-push       # Push schema changes
make db-seed       # Seed exercise library + demo user
make db-seed-fake  # Populate demo user with realistic test data
make db-reset-user # Wipe all user data (keeps exercises + user record)
make db-studio     # Open Drizzle Studio
make db-migrate    # Run migrations

# Quality
make lint          # ESLint
make build         # Production build check
make verify        # typecheck + lint + tests (run before pushing)

# Tests (run locally — no Docker needed)
make test          # Run all tests once
make test-watch    # Watch mode
```

Run `make` (or `make help`) to list every target.

### Test data

`db:seed-fake` populates the demo user (id=1) with:
- 2 programs ("Push Pull Legs A" and "Upper Body") with planned exercises and sets
- An active 12-week training cycle with Mon/Wed/Fri slots
- ~12 completed workout sessions spread over the past 4 weeks

```bash
# Populate
docker-compose exec app pnpm db:seed-fake

# Overwrite existing data
docker-compose exec app pnpm db:seed-fake --force

# Wipe everything and start fresh
docker-compose exec app pnpm db:reset-user
```

### Dev environment

```bash
make dev              # Start dev environment
make dev TEST=1       # Run tests before starting
make dev PROD=1       # Build and run production image
make dev SKIP_BUILD=1 # Skip Docker image rebuild
make dev CLEAN=1      # Force clean build (no cache)
make logs             # Attach to logs only
```

---

## Tech Stack

| Concern | Tool |
| --- | --- |
| **Framework** | Next.js 16 — App Router, React Server Components |
| **Language** | TypeScript (Strict Mode) |
| **Database** | PostgreSQL 16 (Dockerized) |
| **ORM** | Drizzle ORM |
| **Authentication** | Better Auth |
| **Validation** | Zod — required on all Server Actions |
| **Styling** | Tailwind CSS 4 |
| **UI** | shadcn/ui + Lucide React |
| **PWA** | Serwist (Service Workers) |
| **Testing** | Vitest |

---

## Development Guidelines

### Data & State
- **Server Components** for all data fetching — never fetch in Client Components unless required for interactivity
- **Server Actions** for all mutations — no REST routes for CRUD
- **Zod validation** on every Server Action before touching the database
- **Local state** (`useState`) only for UI interaction — no Redux/Zustand

### UI & Mobile-First
- Every screen must feel like a native iOS app (fixed headers, bottom nav)
- Touch targets minimum **44×44px**
- Use `:active` for tap feedback, not `:hover`
- Primary actions go in pinned bottom bars
- Destructive actions at the bottom of the screen

### Code Quality
- **Reuse before adding** — always check for existing components, hooks, and utilities before writing new ones. The feature-component split and `src/lib/utils/` exist for this reason. Adding a duplicate `formatTime` or a second picker modal is worse than importing the shared one.
- **No dead code** — if a button has no `onClick`, remove it or implement it. Don't leave placeholder UI.
- **No premature abstractions** — don't extract a helper for something used once. Wait until it's needed in two or more places.

### Directory Structure
```
src/
├── app/                  # Next.js pages and layouts only
├── components/
│   ├── features/         # Feature-specific Client Components
│   └── ui/               # shadcn/ui base components
├── contexts/             # React Contexts (e.g. WorkoutSessionContext)
├── db/
│   ├── index.ts          # Drizzle client
│   └── schema/           # Schema definitions — single source of truth for types
├── lib/
│   ├── actions/          # Server Actions (one file per domain)
│   ├── utils/            # Pure utility functions (format, set-mapping, etc.)
│   └── validators/       # Zod schemas (colocated with actions)
├── __tests__/            # Vitest unit tests
└── types/                # Shared TypeScript types (inferred from Drizzle)
```

---

## Database Schema

| Table | Purpose |
|---|---|
| `exercises` | Exercise library (system + custom) |
| `programs` | Workout templates |
| `program_exercises` | Exercises within a program |
| `workout_sessions` | Workout logs (date, duration) |
| `workout_sets` | Sets performed (reps, weight, RPE) |

Types are inferred from Drizzle schema — never define them manually:
```ts
type ProgramSet = typeof programSets.$inferSelect;
```

---

## MCP Server

The app exposes a **Model Context Protocol** endpoint so MCP clients (Claude Desktop/Code, etc.) can read and write your programs, training cycles, and profile/weight on your behalf.

- **Endpoint:** `http://localhost:3000/api/mcp` (Streamable HTTP)
- **Auth:** OAuth via Better Auth's `mcp` plugin. The client runs the OAuth flow against your normal login; the access token is scoped to your user. Discovery metadata lives at `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource`.
- **Scope:** read + write for **programs** (incl. exercises/sets), **training cycles** (incl. slots), and **profile/weight**. `userId` is always taken from the token — never a tool argument — so a client can only ever touch its own data.

**Connect a client** — point it at the endpoint URL and complete the browser OAuth prompt. With the Claude Code CLI:
```bash
claude mcp add --transport http logeverylift http://localhost:3000/api/mcp
```

**Tools** (~13): `list_programs`, `get_program`, `create_program`, `update_program`, `delete_program`, `edit_program_exercise`; `list_training_cycles`, `get_training_cycle`, `manage_training_cycle`, `edit_cycle_slot`; `get_profile`, `update_profile`, `manage_weight`. Tool code lives in `src/lib/mcp/tools/`; the route is `src/app/api/[transport]/route.ts`.

> **Adding npm deps for the dev container:** `node_modules` is an anonymous Docker volume baked from the image, so a host-only `pnpm add` won't reach the running container. After changing dependencies, rebuild: `docker-compose build app && docker-compose up -d --force-recreate --renew-anon-volumes app` (or `make dev CLEAN=1`).

## Deployment

### Production
```bash
docker build -t logeverylift-pwa:latest .
docker run -p 3000:3000 -e DATABASE_URL=... logeverylift-pwa:latest
```

**Environment variables:**
- `DATABASE_URL` — `postgresql://user:pass@host:5432/db`
- `NODE_ENV` — `development` or `production`
- `NEXT_TELEMETRY_DISABLED` — `1`

---

## Repository structure

```text
logeverylift/
├── src/               # Application code (see Directory Structure above)
├── drizzle/           # Committed SQL migrations + meta snapshots
├── scripts/           # Dev, DB, and migration scripts (dev.sh, migrate.ts, seed.ts)
├── e2e/               # Playwright end-to-end specs
├── public/            # Static assets and PWA icons
├── docs/              # Project documentation
└── .github/
    └── workflows/     # CI and security pipelines
```

---

## Workflows

| Workflow | Trigger | Purpose |
| -------- | ------- | ------- |
| CI | push, PR | typecheck, tests, build & push Docker image |
| Dependency Review | PR | block PRs that introduce known-vulnerable dependencies |
| Scorecard | push, weekly | OpenSSF supply-chain grade → Security tab + badge |
| Container Scan | push, weekly | Trivy image scan → Security tab |

---

## Troubleshooting

- **Port 3000 in use:** `lsof -i :3000`
- **DB connection failed:** `docker-compose ps` / `docker-compose logs postgres`
- **Type errors after schema change:** `docker-compose exec app pnpm db:generate`

---

<div align="center">

### ⭐ Star this repo if you find it useful ⭐

<a href="https://www.star-history.com/#mortennordbye/logeverylift&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=mortennordbye/logeverylift&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=mortennordbye/logeverylift&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=mortennordbye/logeverylift&type=Date" width="600" />
  </picture>
</a>

Made by [Morten Nordbye](https://github.com/mortennordbye)

</div>
