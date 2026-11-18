/**
 * An FTP test ride's result as the summary and get_ride show it
 * (docs/plans/bike-ride-logger.md, 4.9): the pure `ftpTestView` plus whether
 * it is saved, which is a stored row and not a matching current FTP: a live
 * test threshold of this protocol, measured on the ride's date, with this
 * value.
 *
 * Plain server code: callers resolve the user.
 */

import { testThresholdSaved } from "@/lib/athlete-profile";
import { ftpTestThreshold, ftpTestView, type FtpTestView, type TestStreamPower } from "@/lib/utils/ftp-tests";
import type { StepLog } from "@/lib/utils/ride-results";
import type { RidePlan } from "@/lib/utils/ride-timeline";
import { localDateStr } from "@/lib/utils/user-date";

export type RideFtpTest = FtpTestView & { measuredOn: string };

export async function rideFtpTest(
  userId: string,
  ride: { plan: RidePlan; startedAt: Date | number; timeZone: string | null },
  logs: Record<number, Pick<StepLog, "status" | "avgPower">>,
  stream: TestStreamPower | null,
  currentFtp: number | null,
): Promise<RideFtpTest | null> {
  const view = ftpTestView(ride.plan, logs, stream, currentFtp);
  if (!view) return null;
  const measuredOn = localDateStr(new Date(ride.startedAt), ride.timeZone);
  if (!view.result) return { ...view, measuredOn };
  const { protocol } = ftpTestThreshold(view.result);
  const saved = await testThresholdSaved(userId, { kind: "ftp", protocol, measuredOn, value: view.result.ftp });
  return { ...view, saved, measuredOn };
}
