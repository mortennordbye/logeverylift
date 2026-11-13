/** Input of the step results action (docs/plans/endurance-app.md, 5.2). The steps are checked against the workout on the server. */

import { z } from "zod";

export const saveStepResultsSchema = z.object({
  plannedSessionId: z.number().int().positive(),
  steps: z.array(z.unknown()).min(1).max(400),
  sessionRpe: z.number().int().min(1).max(10).nullable().optional(),
  distanceMeters: z.number().int().min(0).max(1_000_000).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  source: z.enum(["player", "manual"]),
  clientKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).nullable().optional(),
  startedAt: z.number().int().positive().nullable().optional(),
  finishedAt: z.number().int().positive().nullable().optional(),
  pausedSeconds: z.number().int().min(0).max(86_400).optional(),
});
