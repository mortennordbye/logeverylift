---
name: privacy-compliance
description: GDPR and privacy check for LogEveryLift changes. Use whenever a change adds or changes a table or column holding user data, sends data to a new outside service (an API, model provider, analytics, error tracking, email), adds browser storage (localStorage, cookies, caches), changes what friends or other users can see, changes the privacy policy or terms, or when asked about GDPR, personal data, consent, data export or account deletion.
---

# Privacy compliance

LogEveryLift is open to anyone in the EEA and stores health data (body weight, heart rate, readiness, notes), so GDPR applies in full, including Article 9. The controller is a private individual in Norway; the supervisory authority is Datatilsynet.

Three files have to agree with each other and with the code:

1. [`docs/privacy/data-inventory.md`](../../../docs/privacy/data-inventory.md), the record of processing, and the source of truth.
2. [`src/app/privacy/page.tsx`](../../../src/app/privacy/page.tsx), what users are told. Written from the inventory.
3. [`src/app/terms/page.tsx`](../../../src/app/terms/page.tsx), the terms, including the early-access disclaimer (no uptime guarantee, data loss possible, best-effort security).

The version users accepted is `LEGAL_VERSION` in [`src/lib/constants/legal.ts`](../../../src/lib/constants/legal.ts). Bumping it sends every user through `/consent` on their next visit to the home screen.

## Checklist for a change

Go through each question. A "yes" means work in this PR, not a BACKLOG entry.

1. **New table or column with user data?**
   - Add it to the inventory: what, purpose, legal basis, retention.
   - If it hangs off `user` by a foreign key, add it to `collectUserData` in `src/lib/account-data.ts`. The coverage test in `src/__tests__/integration/account-data.test.ts` fails until you do.
   - Leave credentials (hashes, tokens, secrets) out of the export with `columnsWithout`.
   - Give it `onDelete: "cascade"` (or `set null` where another user's row must survive), so account deletion removes it.
   - If another user's rows can reference it (like custom exercises in copied programs), make sure deleting the owner can't delete the other user's data. See `handOverSharedCustomExercises`.
2. **Health-type data?** Body measurements, heart rate, pain, injury, illness, mood, sleep and free-text notes are special category. They are covered by the health-data consent given at sign-up only if the inventory and the policy name the category. If it's a new kind of data, list it and bump `LEGAL_VERSION`.
3. **Data leaving the server?** Any new `fetch` to a third party with user data, or a new script or SDK in the browser:
   - Name the recipient, what is sent, the country and the transfer basis in both the inventory and the policy.
   - Send the minimum. An age band rather than a birth year, never the email or name unless the feature needs it.
   - If the user doesn't strictly need it for the service, gate it behind an opt-in like `aiConsentAt`, and enforce it in the Server Action, not only in the UI.
   - Check the provider's terms for EEA restrictions. Google's free Gemini API tier, for example, is not allowed for apps serving EEA users.
   - Bump `LEGAL_VERSION`.
4. **New browser storage?**
   - Strictly necessary storage needs no banner, but it must be listed in the inventory.
   - Anything for analytics or tracking needs prior consent (ekomloven §3-15), which the app doesn't have. Don't add it without building that first.
   - Check that `clearLocalUserData` (`src/lib/utils/local-data.ts`) removes the new key on sign-out unless it is a pure display setting.
5. **Visible to other users?** Never expose email addresses or health data to other users. Friend search matches an email only in full and never returns it (`searchUsers`). Respect `showActivityToFriends`.
6. **Logs?** Log ids and short tags only, never names, emails, notes or request bodies.
7. **Retention?** Anything that grows forever without a user action needs a retention rule in the inventory and, if it isn't covered by account deletion, a purge (see `purgeExpiredSessions`).

## Changing the policy or terms

- Edit the inventory first, then the page.
- Only write claims you've checked against the code or the config: open the file, run the query, read the provider's current terms. The policy is a legal statement; a wrong claim in it is worse than a missing one.
- Bump `LEGAL_VERSION` (to today's date) when what is collected, why, who receives it, or the user's obligations change. Wording fixes need no bump.
- Keep the early-access notice (`EarlyAccessNotice` in `src/components/features/LegalPage.tsx`) honest about uptime, data loss and security. Don't disclaim GDPR security or breach duties: they can't be waived by contract.
- Plain language, no em dashes, short sentences.

## Tests to keep green

- `src/__tests__/integration/account-data.test.ts`: export coverage, credential exclusion, deletion hand-over, session purge.
- `src/__tests__/integration/legal.test.ts`: consent recording and the gate.
- `src/__tests__/ai-edit.test.ts`: no model call without the AI opt-in, no Gemini free tier.
- `e2e/account-data.spec.ts`, `e2e/consent.spec.ts`, and the consent sheet spec in `e2e/ai-setup.spec.ts`.

## Not legal advice

These pages were drafted carefully but have not been reviewed by a lawyer; see BACKLOG.md. When a question goes beyond the checklist (a new kind of processing, a DPIA, children, selling or monetising), say so and recommend asking a Norwegian privacy lawyer rather than guessing.
