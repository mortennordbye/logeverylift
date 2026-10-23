"use server";

import { collectUserData } from "@/lib/account-data";
import { requireSession } from "@/lib/utils/session";
import type { ActionResult } from "@/types/workout";

/** Everything stored about the caller, as pretty-printed JSON (GDPR Art. 15 and 20). */
export async function exportMyData(): Promise<ActionResult<string>> {
  const auth = await requireSession();
  try {
    const data = await collectUserData(auth.user.id);
    return { success: true, data: JSON.stringify(data, null, 2) };
  } catch (e) {
    console.error("[exportMyData] failed", e);
    return { success: false, error: "Failed to export your data" };
  }
}
