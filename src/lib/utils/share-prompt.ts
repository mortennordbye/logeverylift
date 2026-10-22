// When to ask a user to share the app. Rare by design: only after they have
// trained with it a few times, and then at most once per interval whatever
// they answered.
export const SHARE_PROMPT_MIN_WORKOUTS = 5;
export const SHARE_PROMPT_INTERVAL_DAYS = 60;

export function shouldShowSharePrompt({
  completedCount,
  lastPromptAt,
  tutorialDone,
  now,
}: {
  completedCount: number;
  lastPromptAt: Date | null;
  tutorialDone: boolean;
  now: Date;
}): boolean {
  if (!tutorialDone) return false;
  if (completedCount < SHARE_PROMPT_MIN_WORKOUTS) return false;
  if (!lastPromptAt) return true;
  const days = (now.getTime() - lastPromptAt.getTime()) / 86_400_000;
  return days >= SHARE_PROMPT_INTERVAL_DAYS;
}
