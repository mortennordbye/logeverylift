import { users } from "@/db/schema";
import type { FieldSource, SyncedField } from "@/lib/utils/field-sources";
import { sql } from "drizzle-orm";

/** The new field_sources with one field's source set; use in the same UPDATE as the value. */
export const withSource = (field: SyncedField, source: FieldSource) =>
  sql`${users.fieldSources} || jsonb_build_object(${field}::text, ${JSON.stringify(source)}::jsonb)`;

/** WHERE condition: the field is not locked by the user. */
export const notLocked = (field: SyncedField) => sql`(${users.fieldSources} -> ${field}::text ->> 'by') is distinct from 'you'`;

/** A sync write found the field locked inside its transaction; nothing was written. */
export class FieldLockedError extends Error {}
