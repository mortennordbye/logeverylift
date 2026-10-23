import { LEGAL_VERSION } from "@/lib/constants/legal";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";

/** Shell for /privacy and /terms: readable text column, public, no app chrome. */
export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="h-[100dvh] overflow-y-auto bg-background">
      <div className="mx-auto max-w-2xl px-4 pt-6 pb-16">
        <Link href="/" className="flex items-center gap-0.5 text-primary active:opacity-70 -ml-1 min-h-[44px]">
          <ChevronLeft className="w-5 h-5" />
          <span className="text-sm font-medium">LogEveryLift</span>
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Effective {LEGAL_VERSION}</p>
        <div className="mt-6 flex flex-col gap-4 text-[15px] leading-relaxed [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1 [&_a]:text-primary [&_a]:underline">
          {children}
        </div>
        <p className="mt-10 text-sm text-muted-foreground">
          <Link href="/privacy">Privacy policy</Link> · <Link href="/terms">Terms of use</Link>
        </p>
      </div>
    </div>
  );
}

/** The early-access notice both legal pages open with. */
export function EarlyAccessNotice() {
  return (
    <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
      <p className="font-semibold">LogEveryLift is in early access</p>
      <p className="mt-1">
        It is a free hobby project run by one person. There is no guarantee of uptime or availability, data can be
        lost, and security is a reasonable best effort rather than a certified standard. Use Download My Data in
        Account regularly if your training history matters to you.
      </p>
    </div>
  );
}
