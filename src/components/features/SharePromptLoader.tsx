import { getMyFriendCode } from "@/lib/actions/friend-invites";
import { isSharePromptDue } from "@/lib/actions/onboarding";
import { SharePrompt } from "./SharePrompt";

export async function SharePromptLoader() {
  if (!(await isSharePromptDue())) return null;
  const code = await getMyFriendCode();
  return <SharePrompt friendCode={code.success ? code.data : null} />;
}
