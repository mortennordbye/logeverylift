/** A dated session's or a slot's priority (docs/plans/workouts-and-compliance.md, 6.4); null = derived. */
export const SESSION_PRIORITIES = ["key", "support", "optional"] as const;
export type SessionPriority = (typeof SESSION_PRIORITIES)[number];
