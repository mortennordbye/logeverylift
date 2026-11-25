# Profile facts into Account

Status: locked by the owner, building on `feat/account-profile`. One PR.

## 1. Goal

Make the app less complex. The facts about the user that live on the Athlete profile page and the
Thresholds page move into the Account page. Two More items and two pages go. Nothing new is added
that the owner did not lock below.

Before: four pages (Account, Athlete profile, Thresholds, interview), More items Account, Athlete
profile, Thresholds. After: two pages (Account, interview), More item Account.

## 2. Locked decisions

1. **Account stays one page.** No sub-pages.
2. **Sections, in this order:**
   - **Profile:** name, email, role, joined (as today).
   - **Goals and training:** the goals chips, strength goal, experience strength (the existing
     `users` experience level), experience endurance (`athlete_profiles.endurance_level`),
     availability, athlete questions (the interview row: "Answered <date>" or "Not answered",
     opens `/more/athlete/interview`).
   - **Body and health:** gender, year of birth, height, body weight, sync weight from Garmin (as
     today), injuries and limits, sick periods.
   - **Training numbers:** max HR, FTP, threshold HR bike, threshold HR run, run threshold pace,
     swim CSS, then "Recently deleted (n)" when there are deleted values.
   - **Security and privacy:** change password, then the Privacy rows of today.
   - **Your data:** as today (export, delete account).
   - **Sign out:** as today.
3. **Edit in place with today's editors.** Each row opens a bottom sheet with the editor that exists
   now: `StrengthStep`, `ExperienceStep`, `AvailabilityStep`, `InjuryList` and `InjurySheet`, the
   sick period list and editor, the thresholds editor with history and the Garmin suggestion. No
   rewritten editors. The consistency line goes inside the sick periods sheet, at the top.
4. **Easy to add on, flat code.** One list of sections and rows in one file (for example
   `src/components/features/account/sections.ts`). A row is an id, a label, a value read from the
   page data, an optional `show` test, and the editor it opens. The page does one loop over the
   sections, keeps one "open row" value, and renders one sheet. Adding a field is one entry. No
   wrapper components around the editors, no context provider, no per-row state, no deep nesting.
   The pattern of the home widget registry (`src/lib/home/widgets/`) is the model, kept flatter.
5. **One data read.** The Account page loads the athlete and threshold data in the same server read
   it already does. No fetch per section.
6. **The endurance switch stays for now.** The rows that are endurance-only today (strength goal,
   experience endurance, availability, injuries, sick periods, athlete questions) show only when
   `enduranceEnabledFor` is true, through the row's `show`. Training numbers show for every user,
   as the Thresholds page does today. The switch removal is a later PR
   ([one-user-premium.md](one-user-premium.md) on `docs/endurance-journeys`).
7. **No schema change.** Strength and endurance experience stay two fields.

## 3. Remove

- `src/app/more/athlete/page.tsx` and `src/app/more/athlete/loading.tsx`. The interview route
  `src/app/more/athlete/interview/page.tsx` stays at its URL.
- `src/app/more/thresholds/page.tsx` and its `loading.tsx`.
- `AthleteProfileClient` and `ThresholdsClient` as page shells, once their parts render from
  Account. Keep and reuse the editor parts; delete only what nothing uses.
- In `MoreClient`: the Thresholds item and `athleteItem` (Workouts and Nutrition stay).
- Back-nav labels for `/more/athlete` and `/more/thresholds` in `src/lib/utils/back-nav.ts`.

## 4. Repoint

Every link, fallback and `revalidatePath` to `/more/athlete` or `/more/thresholds` goes to
`/more/account`: the assistant changes feed, the planned session page's thresholds link, the
interview's done and back targets, the server actions in `src/lib/actions/athlete-profile.ts`,
`workouts-compliance.ts` and `plan-revisions.ts`. `grep -rn "more/athlete\|more/thresholds" src e2e`
must return only the interview route.

## 5. Tests and docs

- Update the unit tests (`back-nav.test.ts` and any test of the removed pages) and the e2e specs
  that go through the old pages (`e2e/thresholds.spec.ts`, `e2e/athlete-interview.spec.ts`,
  `e2e/back-nav.spec.ts` where relevant) so they go through Account.
- `pnpm check:docs` must pass. Fix citations in `docs/` and `BACKLOG.md` that point at removed
  files or moved lines (`docs/plans/athlete-profile.md`, `docs/plans/back-navigation.md`,
  `docs/plans/workouts-and-compliance.md`).
- Check `docs/privacy/data-inventory.md` for the old page names; no data changes.

## 6. Garmin sync (locked by the owner)

Garmin is Premium: an add-on that fills fields the user can also type. Only Premium users see any
Garmin text on Account or Settings.

1. **Premium check.** New `src/lib/premium.ts` (*new*): is premium by role, and premium for a
   user id. For now Premium is the admin role. `garminAllowed` becomes the premium check plus the
   key check. Account and Settings decide every Garmin line, switch and suggestion through it.
2. **One switch.** "Sync from Garmin" replaces "Sync weight from Garmin". It sits in a small
   "Garmin" section near the top of Account, Premium only, with the line "Keeps body weight, max
   HR, threshold HR, FTP, run pace, availability, time zone and units up to date." The weight
   sync flag on the Garmin connection becomes this one flag (rename by migration, keep the value).
3. **What syncs when the switch is on:**
   - Body weight: as today, every weigh-in, newest wins.
   - Max HR, threshold HR bike, threshold HR run, FTP, run threshold pace: from the same
     estimates `garminSuggestions` makes today, stored as threshold rows with source `garmin`, so
     they show in each number's history.
   - Availability (days and long day): from Garmin's available training days and preferred long
     training days, when Garmin has them.
   - Time zone and units (distance and swim): from the Garmin profile's time zone and measurement
     system.
   - Not synced: swim CSS, gender, year of birth, height, goals, levels, injuries, sick periods.
4. **Typed wins.** A value the user types or tests locks that field: Garmin stops changing it. For
   thresholds the lock is the stored source (`manual` or `test`). For availability, time zone and
   units, one list on the user (*new*) names the locked fields, so a new synced field is one more
   name. When a locked field has a different Garmin value, the row shows "Garmin says <value> ·
   Use". Use stores the Garmin value and removes the lock.
5. **Source line.** Each synced row shows where its value came from in its note line: "From
   Garmin · <date>" or "Set by you · <date>".
6. **Where it runs.** In the Garmin import after a sync, next to the weight sync that exists. Writes
   do not appear as assistant changes.

## 7. Review fixes (locked by the owner)

1. **Existing values are "set by you".** The migration backfills `field_sources`: availability
   where it is set, units where they differ from the defaults, and time zone where it is set.
2. **No long day from Garmin** leaves the stored long day as it is; compare and write the days only.
3. **A deleted Garmin threshold stays deleted:** the sync does not add a value equal to the newest
   deleted `garmin` row of that kind.
4. **The sync checks Premium** and does nothing for a user without it.
5. **Lock check and write are atomic:** thresholds re-read the current row inside the write
   transaction; profile fields set value and source in one statement, and the sync skips a locked
   field in that same statement.
6. **One threshold kind at a time:** a failure in one kind does not stop the others. A Garmin value
   for a kind that already has a `garmin` row dated today updates that row instead of adding one.
7. **The Garmin switch shows its error** under the row.
8. **Weigh-in dates use the user's time zone.**
9. **"Garmin says · Use" shows only on locked fields,** and only on the row (not also inside the
   threshold editor).
10. **The assistant counts as "you".** An undo of an assistant change restores the field's
    earlier source with its value.
11. **Simpler sync:** no generic field wrapper; the page passes the data it already loaded instead
    of the sync view reading it again. The two privacy switches become rows in the sections list.
    `setGarminSync` stops returning the unused weight.

## 8. Grouped buttons instead of one long page (locked by the owner)

This replaces decision 2.1 ("one page, no sub-pages"). The design is
`docs/design/endurance/account-subpages.html` on `docs/endurance-journeys`.

1. **Top Account page:** a card with the user's name and email, which opens Profile. Under it,
   for Premium only, the "Sync from Garmin" row with its switch. Then a "You" group with three
   buttons with no summary line: Goals and training, Body and health, Training numbers.
   Then an "Account" group: Privacy and security, Your data. Then a Sign out button.
2. **Sub-pages:** Profile (name, email, role, joined), Goals and training (the goal chips on the
   page, strength goal, both levels, availability, athlete questions), Body and health, Training
   numbers, Privacy and security, Your data. Each has Back to Account.
3. **Same code shape:** each sub-page renders its section from the existing sections list with the
   same loop, the same open-row value and the same sheet. A group button is one entry (title,
   route). No new editors.
4. **Links:** `#body-profile` and `#training-numbers` anchors become the matching sub-page routes;
   every link that pointed at an Account section points at its sub-page.

## 9. Tuning by the owner

1. The group buttons on the top Account page show no summary line.
2. The primary gym is picked from the gym map only (`/more/gyms`), not from Account.
3. Every Account editor uses one chip style and one Save button (`AthleteProfileParts.tsx`).
4. The in-app intake interview is dropped: every answer it collected is a field on Account. The
   "Make a triathlon plan" option in the season form needs the endurance level and training days,
   which are what the plan reads, and links to Goals and training when one is missing. The
   assistant's `intake_interview` prompt stays. The `interview_completed_at` column is no longer
   read; migration 0107 removes it.
5. Goals is a row that opens its chips in the sheet, like every other row (this replaces "the goal
   chips on the page" in 8.2). The inline-editor option on rows is gone.

## 10. Second review fixes (locked by the owner)

1. **Assistant writes lock too.** The MCP profile tool that sets time zone or units marks that
   field "you" in the same statement, as the Settings actions do.
2. **Availability locks only on a real change.** A save that leaves the days and the long day as
   they are (for example a change of hours only) does not lock availability and stores no new
   source.
3. **A full threshold kind keeps syncing.** When a kind is at its row limit, the sync replaces the
   oldest `garmin` row of that kind in the same transaction instead of failing.
4. **"Use" on availability is one transaction:** clearing the lock and writing Garmin's value happen
   together, and the endurance check comes first.
5. **Undo to an old snapshot sets the source from the restored row:** "you" when it has days,
   otherwise no source.
6. **The sync updates a threshold row in place only while it is still `garmin`** (source in the
   update's condition; no update when it changed).
7. **Time zone syncs first,** and the sync reads the Garmin profile and today's date once and passes
   them to each step.
8. **With "Sync from Garmin" off, every training number shows "Garmin says · Use"** when Garmin's
   estimate differs, so one estimate can be taken without turning the sync on. With the sync on,
   only locked numbers show it (6.4).

## 11. Third review fixes and clean-up (locked by the owner)

1. The e2e specs `seasons` and `plan-repeat-taps` seed endurance level and training days, not the
   interview date.
2. A training number with no stored value shows "Garmin says · Use" when Garmin has an estimate
   (sync off), so 10.8 holds for empty numbers too.
3. Every Account editor uses the shared `chip` and `SubmitButton`, including change password, sick
   periods and the threshold editor. No copies.
4. Remove what the interview removal left unused: the `interviewChangeSet` validator and the
   `changeSetId` fields and props it fed, the `submitLabel` props, `localPath` and its test, exports
   used only inside their file, and stale comments, test titles and docs that describe the in-app
   interview.
5. The athlete restore takes the `athlete_profile` advisory lock first, so it locks in the same order
   as a profile save.
6. The threshold sync reuses the current Garmin row when it is dated today or later.
7. The gym picker's loading skeleton backs to Gyms.
8. `saveAthleteProfile` uses the run's date instead of reading it again.
9. The server refuses a triathlon plan without endurance level and training days.
10. `addThresholdValue` accepts source `garmin` only for Premium users.
