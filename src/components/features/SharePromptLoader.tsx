import { isSharePromptDue } from "@/lib/actions/onboarding";
import { SharePrompt } from "./SharePrompt";

export async function SharePromptLoader() {
  if (!(await isSharePromptDue())) return null;
  return <SharePrompt />;
}
