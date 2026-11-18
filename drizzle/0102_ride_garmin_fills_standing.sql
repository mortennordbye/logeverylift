CREATE UNIQUE INDEX IF NOT EXISTS "uniq_ride_garmin_fills_standing" ON "ride_garmin_fills" USING btree ("ride_id") WHERE NOT "ride_garmin_fills"."declined";
