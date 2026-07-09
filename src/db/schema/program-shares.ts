import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { programs } from "./programs";
import { users } from "./users";

export const programShares = pgTable("program_shares", {
  id: serial("id").primaryKey(),
  programId: integer("program_id")
    .notNull()
    .references(() => programs.id, { onDelete: "cascade" }),
  sharedByUserId: text("shared_by_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  sharedWithUserId: text("shared_with_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // null until recipient copies the program
  copiedProgramId: integer("copied_program_id")
    .references(() => programs.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_program_shares_recipient").on(t.sharedWithUserId),
  index("idx_program_shares_program").on(t.programId),
]);
