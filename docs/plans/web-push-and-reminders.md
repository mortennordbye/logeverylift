# Web push and reminders

Two PRs: **3a** (subscriptions, rest timer push, friend nudges and reactions), then **3b**
(training-day reminder). The work is listed in BACKLOG as "Out-of-app push notifications via
Service Worker"; delete that entry when 3a ships.

## Why
- **Rest timer:** the alert uses an in-page `setTimeout` and the browser Notification API
  (`src/contexts/workout-session-context.tsx`, `src/lib/notifications.ts`). It doesn't fire when
  the phone is locked or the app is in the background, which is the normal case on iOS.
- **Friends:** nudges and reactions only appear in-app.
- **Reminders:** there are none.

## Findings
- **Upgrade path:** `src/lib/notifications.ts` already describes it, and its callers only use
  `requestNotificationPermission` and `sendNotification`.
- **Service worker:** `src/app/sw.ts` is Serwist with default caching and no push handlers.
- **Background jobs:** they run as `setInterval` in `src/instrumentation.ts`. The weekly gym
  import uses an "if stale" check so several pods don't double up. The replica count isn't
  documented, so push scheduling must work with more than one pod.
- **Friend events:** `sendNudge` and `toggleReaction` live in `src/lib/actions/friends.ts`.
- **Sign-out:** clears local data through `clearLocalUserData` (`src/lib/utils/local-data.ts`).
- **Training-day logic:** `getActiveCycleForUser` (`src/lib/actions/training-cycles.ts`) reads
  the user from the session, so a background job can't call it as is.

## Design: 3a
- **Env and dependency:** optional `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`
  in `src/lib/env.ts` and `.env.example`. Push is off when they're unset. Add the `web-push`
  dependency. Store the keys in Bitwarden Secrets Manager and wire them through the cluster's
  ExternalSecret (see the `secrets` skill). Never print them.
- **Tables:**
  - *new* `push_subscriptions`: user id (deleted with the user), unique endpoint, `p256dh`,
    `auth`, timezone, created_at
  - *new* `scheduled_pushes`: user id, kind, send_at; unique on (user, kind), indexed on send_at
- **Sending:** *new* `src/lib/push.ts` with `sendPushToUser(userId, payload)`. It deletes
  subscriptions that answer 404 or 410.
- **Actions:** *new* `src/lib/actions/push.ts` with `savePushSubscription`,
  `deletePushSubscription`, `scheduleRestPush({ endsAt })` (an upsert, so a new rest replaces
  the old one) and `cancelRestPush`.
- **Scheduler:** a 5-second `setInterval` in `src/instrumentation.ts` runs
  `DELETE FROM scheduled_pushes WHERE send_at <= now() RETURNING *` and sends each row. The
  delete claims each row exactly once, so it's safe with several pods.
- **Service worker:** `push` and `notificationclick` handlers in `src/app/sw.ts`.
  - The rest push uses `tag: "rest"`, the same tag as the local notification, so the two
    collapse instead of showing twice.
  - Always call `showNotification`, because Safari can revoke push access when a push shows
    nothing.
- **Rest timer:** `setRestTimerEnd` in `workout-session-context.tsx` schedules the push, and
  clearing the timer cancels it. Both are fire-and-forget, and the timer must keep working when
  push is off or offline.
- **Friends:** `sendNudge` and the insert branch of `toggleReaction` call `sendPushToUser`
  without waiting for it. A failed push never fails the action.
- **Settings:** an "Enable notifications" control in `SettingsClient.tsx`. On iOS outside
  standalone mode, show "Add to Home Screen first" with a link to `/more/install`.
- **Sign-out:** unsubscribe and delete the server subscription, so a shared phone doesn't get
  the previous user's pushes.

## Design: 3b
- *new* userId-based version of today's-slot logic, extracted from `getActiveCycleForUser` so
  the server action and the job share it.
- A reminder hour (nullable) on `push_subscriptions`, set in Settings.
- A 15-minute job sends "Today: {program name}" once per day to users whose local hour matches
  and who haven't trained today. Dedupe with a `scheduled_pushes` row or a last-sent date.

## Privacy (blocking for 3a)
Run the `privacy-compliance` skill.
- **New data:** the device subscription. Add it to `docs/privacy/data-inventory.md` and to
  `collectUserData` in `src/lib/account-data.ts`, leaving the key columns out with
  `columnsWithout`.
- **New recipients:** Apple, Google (FCM) and Mozilla push services, some outside the EEA.
  Payloads are encrypted, but the services see timing and the device.
- **Payload rule:** no weights, health data or notes in payloads. Short generic text only
  ("Rest done", "{friend} nudged you").
- **Policy:** update the policy and bump `LEGAL_VERSION`, not `CONSENT_VERSION` (an update
  notice, not a re-consent).
- **Retention:** `scheduled_pushes` rows only live until sent; subscriptions until unsubscribe,
  a 410, or account deletion.

## Tests
- Unit: the scheduler claim-and-send loop with `web-push` mocked; a 410 deletes the
  subscription.
- Integration:
  - subscription save and delete with ownership
  - the rest push upsert replaces the previous one
  - the account-data coverage test passes
- e2e: Settings UI only. Real push can't run in Playwright. Make sure the rest timer still
  works when push is off.
- Smoke pass (the rest timer is a critical flow). Then a manual check on a real iPhone with the
  app installed.

## Done when
- [ ] 3a: rest-done push arrives with the phone locked (installed PWA); nudges and reactions
  push; the policy is updated; BACKLOG entry deleted.
- [ ] 3b: the training-day reminder arrives once at the chosen hour.
- [ ] `pnpm verify` and the smoke pass are green.
