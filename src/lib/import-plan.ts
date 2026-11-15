/**
 * Imports a plan payload (programs and an optional cycle) from the client:
 * the builder's "Start this plan" and the pasted answer of the user's own AI
 * chat both end here. Calls the Server Actions through callAction.
 */

import { importProgram } from "@/lib/actions/programs";
import { importCycle } from "@/lib/actions/training-cycles";
import { callAction } from "@/lib/utils/stale-bundle";

export type ImportResult =
  | { success: true; successMsg: string; cycleId: number | null }
  | { success: false; error: string };

export async function importPlanPayload(raw: Record<string, unknown>): Promise<ImportResult> {
  const hasProgramData = raw.program !== undefined || raw.programs !== undefined;
  const hasCycle = raw.cycle !== undefined && raw.cycle !== null;
  if (!hasProgramData && !hasCycle) {
    return { success: false, error: 'The JSON doesn\'t contain any programs or a cycle. Make sure you pasted the full AI response and that it includes a "programs" or "cycle" key.' };
  }

  let programCount = 0;
  let cycleName: string | null = null;
  let cycleId: number | null = null;
  const warnings: string[] = [];

  if (hasProgramData) {
    const result = await callAction(importProgram(raw));
    if (!result.success) {
      return { success: false, error: result.error ?? "Failed to import programs." };
    }
    programCount = result.data.count;
    if (result.data.skippedExercises.length > 0) {
      warnings.push(`Some exercises couldn't be resolved and were skipped: "${result.data.skippedExercises.join('", "')}".`);
    }
  }

  if (hasCycle) {
    const result = await callAction(importCycle(raw.cycle));
    if (!result.success) {
      warnings.push(`Cycle couldn't be created: ${result.error ?? "unknown error"}`);
    } else {
      cycleName = result.data.cycleName;
      cycleId = result.data.cycleId;
      if (result.data.unresolvedPrograms.length > 0) {
        warnings.push(
          `Some cycle slots couldn't be linked: "${result.data.unresolvedPrograms.join('", "')}". You can assign them manually in the cycle editor.`,
        );
      }
    }
  }

  const parts: string[] = [];
  if (programCount > 0) parts.push(`${programCount} program${programCount > 1 ? "s" : ""}`);
  if (cycleName) parts.push(`cycle "${cycleName}"`);

  const base =
    parts.length > 0
      ? `Created ${parts.join(" and ")}.`
      : "Nothing was created — the response may have been empty.";
  const suffix = cycleName
    ? " Go to your cycles and start it when you're ready."
    : programCount > 0
      ? " You can find your programs in the Programs tab."
      : "";

  const successMsg = warnings.length > 0 ? `${base}${suffix}\n\n⚠️ ${warnings.join(" ")}` : `${base}${suffix}`;
  return { success: true, successMsg, cycleId };
}
