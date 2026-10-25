// Copy for inviting someone to the app. Plain words, no colons, semicolons or
// dashes, since it lands in other people's chats.
export const SHARE_TITLE = "LogEveryLift";
export const SHARE_TEXT =
  "I've been tracking my training with LogEveryLift and really like it. It builds your program and tells you what to put on the bar next session. Worth a try";

export type ShareOutcome = "shared" | "copied" | "cancelled";

/**
 * Open the native share sheet with an invite to the public landing page, or
 * copy the invite to the clipboard where there is no share sheet (most
 * desktop browsers). Closing the share sheet counts as cancelled. With the
 * sharer's friend code, whoever signs up through the link starts as their
 * friend (redeemFriendCode).
 */
export async function shareApp(origin: string, friendCode?: string | null): Promise<ShareOutcome> {
  const url = friendCode ? `${origin}/welcome?ref=${encodeURIComponent(friendCode)}` : `${origin}/welcome`;
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: SHARE_TITLE, text: SHARE_TEXT, url });
      return "shared";
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return "cancelled";
      // Some browsers expose share() but refuse it (no user gesture, policy);
      // fall through to the clipboard.
    }
  }
  try {
    await navigator.clipboard.writeText(`${SHARE_TEXT}\n\n${url}`);
    return "copied";
  } catch {
    return "cancelled";
  }
}
