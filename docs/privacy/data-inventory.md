# Personal data inventory

The record of processing (GDPR Art. 30) for LogEveryLift, and the source the privacy policy (`src/app/privacy/page.tsx`) is written from. When a change adds, moves or shares personal data, update this file and the policy in the same PR, and bump `LEGAL_VERSION` (`src/lib/constants/legal.ts`) if users need to accept the change. The `privacy-compliance` skill (`.claude/skills/privacy-compliance/SKILL.md`) has the checklist.

Facts last checked 2026-10-23.

## Controller

Morten Victor Nordbye, private individual, Oslo, Norway. Contact morten@nordbye.it. Supervisory authority: Datatilsynet. No DPO (not required: one person, not large-scale monitoring).

## Data in the database

All tables live in the app's Postgres in the homelab (Norway). Every user-owned table cascades on user deletion, and `collectUserData` (`src/lib/account-data.ts`) exports all of them; `src/__tests__/integration/account-data.test.ts` fails if a table hanging off `user` is missing from the export.

| Category | Tables | Purpose | Legal basis | Retention |
|---|---|---|---|---|
| Account | `user` (name, email, role, ban fields), `account` (scrypt password hash) | Login, identity | Art. 6(1)(b) contract | Until account deletion |
| Consent records | `user` (`termsVersion`, `termsAcceptedAt`, `healthConsentAt`, `aiConsentAt`) | Proof of consent (Art. 7(1)) | Art. 6(1)(c) legal obligation | Until account deletion |
| Profile (optional) | `user` (gender, birth year, height, weight, goals, experience), `user_weight_entry` | Plans, progression, AI Setup | Art. 9(2)(a) explicit consent | Until deleted by user or account deletion |
| Training log | `workout_sessions` (notes, feeling, readiness), `workout_sets` (reps, weight, duration, distance, heart rate zone, RIR/RPE, failed, notes), `exercise_prs`, `custom_weight_usage`, `dismissed_makeups`, `exercises` (custom) | The core service | Art. 6(1)(b) + 9(2)(a) | Until account deletion |
| Plans | `programs`, `program_exercises`, `program_sets`, `training_cycles`, `training_cycle_slots`, `ai_setup_plans`, `ai_generations` | The core service, AI Setup daily limit | Art. 6(1)(b) | Until account deletion |
| Social | `friendships`, `nudges`, `workout_reactions`, `program_shares`, `invite_token` | Friends features | Art. 6(1)(b) | Until either side deletes |
| Feedback | `feedback` | Improving the app | Art. 6(1)(f) | Until account deletion |
| Sessions | `session` (IP address, user agent, `impersonatedBy`) | Keeping users signed in, security | Art. 6(1)(f) | Purged after expiry (30 days from last use) by `purgeExpiredSessions` |
| MCP connections | `oauth_application`, `oauth_access_token`, `oauth_consent` | User-connected AI assistants | Art. 6(1)(b), on the user's instruction | Until revoked or account deletion |

Not personal data: `ai_plan_cache` (keyed by a hash of an age band, gender, goals and the request; no user id), `ai_model_configs`, built-in `exercises`.

Health data (Art. 9): body weight and its history, heart rate zones, readiness, feeling, RPE/RIR, failed sets, free-text notes, "joints to avoid" in AI Setup picks. Treated as special category; the basis is explicit consent given at sign-up (`acceptTerms` in `src/lib/actions/legal.ts`).

## Outside the database

- **Server logs** (Loki in the homelab): 7 days. Rate-limit warnings in `src/app/api/auth/[...all]/route.ts` include the client IP. Server Actions log ids and short tags only, never names, emails or request bodies (CLAUDE.md, Safety rules).
- **Backups:** daily `pg_dump`, kept 30 days on the homelab NAS; off-site copy to Google Drive by Synology Hyper Backup, client-side encrypted, Smart Recycle up to 30 versions. The policy promises rotation within 90 days.
- **Browser** (`src/lib/utils/local-data.ts` lists what survives sign-out): session cookie and its 5-minute cache cookie; localStorage `activeWorkout`, `restTimerEnds`, `workoutOverrides`, `workoutReadiness`, `pendingMutationQueue`, `ai_generating`, `ai_pending_edit`, `ai_pending_error`, `weeklyGoal`, admin backups, and display settings (`theme`, `accentColor`, `customAccentHex`, `uiScale`); service worker caches. All strictly necessary, so no consent banner (ekomloven §3-15). `clearLocalUserData` empties everything but display settings on sign-out and deletion.

## Recipients and transfers

| Recipient | What | Why | Transfer basis |
|---|---|---|---|
| Cloudflare (USA) | All HTTP traffic incl. IP | Proxy, TLS, DDoS protection | EU-US DPF, SCCs in Cloudflare's DPA |
| Google Drive (Google) | Encrypted backups only, no key | Off-site backup | Data is unreadable to Google |
| OpenRouter and its model providers | AI Setup edit request (see `buildEditInput` in `src/lib/utils/ai-prompt.ts`) | AI editing | Explicit opt-in, `aiConsentAt`; Art. 49(1)(a) for third countries. Free models may retain and train |
| Other users | Name, avatar, today's activity (toggle), reactions, nudges, shared programs | Friends | Art. 6(1)(b) |
| AI assistants the user connects (MCP) | Profile, weight, programs, cycles | User's instruction | The user's own choice |

Not used: Gemini API (its free tier is not allowed for apps serving EEA users; `getEnabledModels` filters the `google` provider out), Sentry (no DSN in prod; if enabled, add it here and to the policy), analytics, ads, email sending.

## Access by the operator

The admin can read the database and impersonate users (Better Auth admin plugin); impersonated sessions carry `impersonatedBy`. Disclosed in the policy as support and debugging only. The consent gate (`needsTermsConsent` in `src/lib/consent.ts`) never shows to an impersonating admin.

## Data subject rights in the app

- Access and portability: Account → Download My Data (`exportMyData`).
- Erasure: Account → Delete Account (Better Auth `deleteUser`; `handOverSharedCustomExercises` runs first).
- Rectification: in-app editing.
- Withdraw AI consent: Account → AI editing (`setAiConsent`).
- Everything else by email, answered within one month.
