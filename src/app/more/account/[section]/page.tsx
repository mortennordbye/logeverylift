import { AccountClient } from "@/components/features/AccountClient";
import { SUB_PAGES, isSubPage } from "@/components/features/account/pages";
import { BackLink } from "@/components/ui/BackLink";
import { notFound } from "next/navigation";
import { loadAccountData } from "../load-account";

/** One Account sub-page (docs/plans/account-profile.md, 8): its section, with Back to Account. */
export default async function AccountSubPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!isSubPage(section)) notFound();
  const title = SUB_PAGES[section];
  const { data, error } = await loadAccountData();
  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <BackLink fallback={{ href: "/more/account", label: "Account" }} />
      </div>

      <div className="px-4 pt-2 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      </div>
      {error && <p className="px-4 text-sm text-destructive">{error}</p>}

      <AccountClient data={data} page={section} />
    </div>
  );
}
