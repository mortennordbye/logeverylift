-- Values set before the Garmin sync existed were set by the user: lock them (docs/plans/account-profile.md, 7.1).
UPDATE "user" u
SET "field_sources" = u."field_sources" || jsonb_build_object('availability', jsonb_build_object('by', 'you', 'on', to_char(p."updated_at", 'YYYY-MM-DD')))
FROM "athlete_profiles" p
WHERE p."user_id" = u."id"
  AND p."deleted_at" IS NULL
  AND coalesce(cardinality(p."available_days"), 0) > 0
  AND NOT (u."field_sources" ? 'availability');
--> statement-breakpoint
UPDATE "user"
SET "field_sources" = "field_sources" || jsonb_build_object('units', jsonb_build_object('by', 'you', 'on', to_char(now(), 'YYYY-MM-DD')))
WHERE ("distance_unit" <> 'km' OR "swim_unit" <> 'm')
  AND NOT ("field_sources" ? 'units');
--> statement-breakpoint
UPDATE "user"
SET "field_sources" = "field_sources" || jsonb_build_object('timeZone', jsonb_build_object('by', 'you', 'on', to_char(now(), 'YYYY-MM-DD')))
WHERE "time_zone" IS NOT NULL
  AND NOT ("field_sources" ? 'timeZone');
