"use client";

import { PRIMARY_BUTTON } from "@/components/features/season-ui";
import { PlanSheetPanel, SHEET_CANCEL } from "@/components/features/PlanSheetPanel";
import { keepDates } from "@/lib/utils/keep-dates";
import { BottomSheet } from "@/components/ui/BottomSheet";

/**
 * The confirm before a season takes the one scheduled start (New season, a
 * season's first phase, Resume): what that ends and drops, in the shared
 * words (takeStartLines), and the action, or Cancel.
 */
export function TakeStartSheet({
  open,
  title,
  lines,
  action,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  lines: string[];
  action: string;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet open={open} onClose={onClose}>
      {open && (
        <PlanSheetPanel
          label={title}
          title={keepDates(title)}
          sub={lines.map((l) => (
            <p key={l} className="text-sm text-muted-foreground">
              {keepDates(l)}
            </p>
          ))}
        >
          {error && (
            <p role="alert" className="text-sm text-[#ff6b5a]">
              {error}
            </p>
          )}
          <button type="button" disabled={busy} onClick={onConfirm} className={PRIMARY_BUTTON}>
            {action}
          </button>
          <button type="button" onClick={onClose} className={SHEET_CANCEL}>
            Cancel
          </button>
        </PlanSheetPanel>
      )}
    </BottomSheet>
  );
}
