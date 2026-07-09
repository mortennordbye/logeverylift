"use client";

import { authClient } from "@/lib/auth-client";
import { DEMO_USER_EMAIL } from "@/lib/constants/demo";

export function ImpersonationBanner() {
  const { data: session } = authClient.useSession();

  if (!session?.session.impersonatedBy) return null;
  if (session.user.email !== DEMO_USER_EMAIL) return null;

  return (
    <div className="fixed top-2 right-2 z-50 text-[10px] font-bold tracking-widest px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30 pointer-events-none select-none">
      DEMO
    </div>
  );
}
