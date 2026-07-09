/**
 * Auth layout — no bottom navigation, full-screen with keyboard-aware scroll.
 *
 * The outer div is h-[100dvh] + overflow-y-auto so ViewportFix can find a
 * scrollable parent (findScrollableParent walks up looking for overflow-y: auto).
 *
 * The inner div uses minHeight: calc(100dvh + var(--kb-height, 0px)):
 * - Keyboard closed → --kb-height is 0px → inner == outer → no scrollable empty space
 * - Keyboard open   → --kb-height is ~350px → inner is 350px taller → ViewportFix
 *   can scroll the focused input above the keyboard
 *
 * ViewportFix (in root layout) updates --kb-height on every visualViewport resize.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="h-[100dvh] bg-background overflow-y-auto">
      <div
        className="flex flex-col items-center w-full"
        style={{
          minHeight: "calc(100dvh + var(--kb-height, 0px))",
          paddingTop: "20dvh",
        }}
      >
        {children}
      </div>
    </div>
  );
}
