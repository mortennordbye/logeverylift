"use client";

/**
 * The chip and Save button every Account editor shares. Kept apart from the
 * editors, so a component that needs only these does not load their Server
 * Actions.
 */

export const chip = (on: boolean) =>
  `min-h-[44px] rounded-xl text-sm font-medium active:opacity-70 ${on ? "bg-primary text-primary-foreground" : "bg-muted"}`;

export function SubmitButton({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-xl bg-primary py-4 text-sm font-semibold text-primary-foreground disabled:opacity-50 active:opacity-80"
    >
      {label}
    </button>
  );
}
