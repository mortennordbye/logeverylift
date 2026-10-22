import { SignupForm } from "@/components/features/SignupForm";
import { shareMetadata } from "@/lib/share-metadata";
import { getOptionalSession } from "@/lib/utils/session";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export function generateMetadata(): Promise<Metadata> {
  return shareMetadata({
    title: "Join LogEveryLift",
    description: "Log your sets, follow a plan built for you and see what to lift next time.",
    path: "/signup",
  });
}

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
