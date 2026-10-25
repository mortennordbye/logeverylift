# Share card and recap

## Why
- **Share card:** sharing (`src/lib/utils/share.ts`) only shares an invite link. Lifters like
  posting a finished workout or a new record as an image.
- **Recap:** there's no monthly or yearly summary, even though `src/lib/actions/metrics.ts`
  already computes every input.

## Findings
- **Image rendering:** `src/app/og-image.png/route.tsx` already renders an image with
  `next/og`. Use it as the style reference.
- **Session data:** `getSessionDetail` in `src/lib/actions/workout-sets.ts` returns a session's
  sets and checks the session belongs to the user.
- **Records:** `src/components/features/PrFeedList.tsx` renders a list of records.
- **Depends on:** the exercise detail page brief (shared chart component) and the edit past
  sessions brief (records stay correct after edits). Build those first.

## Design
- **Image route:** *new* `src/app/history/[sessionId]/share-image/route.tsx` (GET).
  - It requires a session and loads through `getSessionDetail`, so another user gets 404.
  - It renders a card: date, program name, duration, total volume, top sets, and records set in
    that session.
  - Send `Cache-Control: private, no-store`. The client fetches it same-origin with cookies, so
    no public or signed URL is needed.
- **Sharing:** *new* `shareImage(blob, title)` in `share.ts`. Uses `navigator.share({ files })`
  when `navigator.canShare` allows it, and falls back to downloading the PNG. Add a Share
  button on the session detail page and on the finish page.
- **Recap data:** *new* `getRecap({ from, to })` in `metrics.ts`, filtered by the session user.
  Returns session count, total volume, total time, records in range, top exercises by volume,
  and the most-trained muscle.
- **Recap page:** *new* `src/app/more/recap/page.tsx` (plus `loading.tsx`). Switches between
  month and year, defaulting to the last full month. Reuses `PrFeedList`. Linked from
  `MoreClient.tsx`. Optionally the recap also gets a share image through the same pattern.

## Files
`src/app/history/[sessionId]/share-image/route.tsx` (new), `src/lib/utils/share.ts`,
`src/lib/actions/metrics.ts`, `src/app/more/recap/page.tsx` (new),
`src/components/features/SessionDetailClient.tsx`, `src/components/features/MoreClient.tsx`.

## Tests
- Integration: the image route returns 404 for another user's session. `getRecap` counts only
  the user's sessions inside the range.
- Unit: month and year range boundaries, including timezones and the year end, in a pure helper.
- e2e: the Share button either opens the share sheet or downloads, with no page errors.

## Privacy
- The image is made only when the user taps Share, and the user decides where it goes.
- Never put notes, RIR, readiness or body weight on the card.
- Run the `privacy-compliance` skill. The policy may need a line on user-initiated sharing.

## Done when
- [ ] Share works from session detail and the finish page.
- [ ] Recap page shows month and year.
- [ ] `pnpm verify` green.
