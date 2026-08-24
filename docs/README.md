# Developer docs

Living maps of the codebase, so you can find "where does X live / how does Y flow" without re-reading the whole tree. These are **reference maps**, not rules — for working conventions (dev loop, Server Action template, migration workflow, smoke protocol) see [`CLAUDE.md`](../CLAUDE.md).

## Two kinds of doc

A **map** answers *where does this live and how does it flow*; it changes when the code moves. A **spec** ([`specs/`](specs/)) answers *what is this supposed to do, and why*; it changes when the intent changes, and when the code contradicts it that is a bug rather than a stale doc.

## How to use these

- Each doc is anchored to real `file.ts:line`-style paths. When you change something a doc describes, update the doc in the same change.
- Keep entries terse and skimmable (tables, bullets). Add a note whenever you learn something non-obvious that the next person would otherwise rediscover the hard way.
- Don't duplicate `CLAUDE.md` or `OPERATIONS.md` — link to them.

## Index

| Doc | What it covers |
|---|---|
| [data-model.md](data-model.md) | DB tables, the core domain graph, key columns & the non-obvious ones (derived `rpe`, type override, peak anchors) |
| [workout-and-sets.md](workout-and-sets.md) | Program set (blueprint) vs logged set, the SetEditView's two modes, RIR (logged vs target), exercise type, failed sets, how effort feeds progression |
| [cycles-and-plans.md](cycles-and-plans.md) | Training cycles & slots, the triathlon plan generator (Workout A/B + endurance week), periodization & no-wearable adaptation |
| [gotchas.md](gotchas.md) | The traps that bit us — Turbopack cache corruption, local-DB migration, fail-safes for deleted entities, E2E creds |
| [OPERATIONS.md](OPERATIONS.md) | Prod ops runbook (health probes, boot order, env, rate limits) |

## Specs

Behaviour specs — numbered, citable rules stating what a feature is meant to do. The format and how to write one are in [`specs/README.md`](specs/README.md).

| Spec | What it covers | Last verified |
|---|---|---|
| [specs/smart-incrementation.md](specs/smart-incrementation.md) | Progressive overload: increment sizing, the confidence & consensus gates, deload, retry, readiness, felt-easy, the seven progression modes, the plan ratchet | 2026-08-24 @ `3a09857` |

## Conventions recap (the short version — full text in CLAUDE.md)

- **Server Components fetch, Server Actions mutate.** Every action starts with `requireSession()`/`requireAdmin()` and filters by `userId` (or `assertOwner`). Never accept `userId` as a param.
- **Types are inferred from Drizzle** (`typeof table.$inferSelect`) — never hand-written.
- **Migrations are committed SQL** in `drizzle/`; never generated at build time. Schema change → `pnpm db:generate` → commit the `.sql` + `meta/` snapshot together.
- **Dev runs in Docker** (`make dev`); tests run locally (`make test`); gate with `make verify` before calling a task done.
