"use client";

import { type BackDecision, type BackTarget, resolveBack } from "@/lib/utils/back-nav";
import { readPrevEntry } from "@/lib/utils/nav-history";
import { markProgrammaticBack } from "@/lib/utils/nav-intent";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type MouseEvent, useLayoutEffect, useState } from "react";

function decide(fallback: BackTarget): BackDecision {
  return resolveBack(readPrevEntry(), window.location.pathname + window.location.search, fallback);
}

/**
 * Back for a page: to where the user came from when that is in the app, else
 * to `fallback`, the page's parent. Use `BackLink` for a header; this hook is
 * for a button or a gesture.
 *
 * The decision is read once, on mount, in a layout effect. By then the router
 * has written this page's history entry (it does so in an insertion effect of
 * the same commit), and it is still before paint, so a client navigation never
 * shows the wrong name. The server and the hydrating client render the
 * fallback, so after a reload of a deep page the name can change once.
 */
export function useBack(fallback: BackTarget): { label: string; onClick: (e: MouseEvent) => void; go: () => void } {
  const router = useRouter();
  const [decision, setDecision] = useState<BackDecision>({ kind: "link", ...fallback });
  const { href, label } = fallback;

  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- history.state is unavailable at SSR render; the first client render must match the server HTML
    setDecision(decide({ href, label }));
  }, [href, label]);

  const pop = () => {
    markProgrammaticBack();
    router.back();
  };

  return {
    label: decision.label,
    onClick: (e) => {
      if (decision.kind !== "pop") return;
      e.preventDefault();
      pop();
    },
    // Read again at the call: the page may have changed its own entry since mount.
    go: () => {
      if (decide({ href, label }).kind === "pop") pop();
      else router.replace(href);
    },
  };
}

/** The "< Name" header control. Renders a real link to the fallback. */
export function BackLink({ fallback }: { fallback: BackTarget }) {
  const back = useBack(fallback);
  return (
    <Link
      href={fallback.href}
      onClick={back.onClick}
      data-testid="back-link"
      className="flex items-center gap-0.5 text-primary active:opacity-70 -ml-1 min-h-[44px] min-w-0"
    >
      <ChevronLeft className="w-5 h-5 shrink-0" />
      <span className="text-sm font-medium truncate max-w-[60vw]">{back.label}</span>
    </Link>
  );
}

/**
 * The label alone, for a loading skeleton that stands in for a page's header.
 * Without a fallback it says "Back" where there is nothing to go back to.
 */
export function BackLabel({ fallback = { href: "", label: "Back" } }: { fallback?: BackTarget }) {
  const back = useBack(fallback);
  return <>{back.label}</>;
}
