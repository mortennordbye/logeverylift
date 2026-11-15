import { AccountClient } from "@/components/features/AccountClient";
import { BackLink } from "@/components/ui/BackLink";
import { loadAccountData } from "./load-account";

export default async function AccountPage() {
  const { data, error } = await loadAccountData();
  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <BackLink fallback={{ href: "/more", label: "More" }} />
      </div>

      <div className="px-4 pt-2 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">Account</h1>
      </div>
      {error && <p className="px-4 text-sm text-destructive">{error}</p>}

      <AccountClient data={data} page={null} />
    </div>
  );
}
