import { FtpSheet } from "@/components/features/bike/FtpSheet";
import type { BikeNumbers } from "@/lib/bike-numbers";
import { ftpChangedText, ftpLineText, watchFtpNote } from "@/lib/utils/bike-numbers";

/**
 * The FTP line on the session page (bike-sessions.md 5.2): the FTP and its
 * basis, a one-time change note, the watch FTP note, and "Change".
 * `planFtpTestHref` is the target of "Plan an FTP test" in the sheet.
 */
export function FtpLine({ numbers, planFtpTestHref }: { numbers: BikeNumbers; planFtpTestHref?: string }) {
  const changed = ftpChangedText(numbers.ftp);
  const watch = watchFtpNote(numbers);
  return (
    <section className="rounded-xl bg-card px-4 py-2 space-y-1" data-testid="ftp-line">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm">{numbers.ftp ? ftpLineText(numbers.ftp) : "No FTP set"}</p>
        <FtpSheet numbers={numbers} planFtpTestHref={planFtpTestHref} />
      </div>
      {changed && (
        <p className="text-xs text-primary" data-testid="ftp-changed">
          {changed}
        </p>
      )}
      {watch && (
        <p className="text-xs text-amber-600 dark:text-amber-400 pb-1" data-testid="ftp-watch-note">
          {watch}
        </p>
      )}
    </section>
  );
}
