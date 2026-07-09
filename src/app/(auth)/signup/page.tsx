import { SignupForm } from "@/components/features/SignupForm";
import { getOptionalSession } from "@/lib/utils/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const session = await getOptionalSession();
  if (session) redirect("/");

  return (
    <div className="w-full max-w-sm px-6">
      <div className="mb-10 text-center">
        <h1 className="text-3xl font-bold tracking-tight">LogEveryLift</h1>
        <p className="mt-2 text-sm text-muted-foreground">Create your account</p>
      </div>
      <SignupForm />
    </div>
  );
}
