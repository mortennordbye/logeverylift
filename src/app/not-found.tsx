import Link from "next/link";

/**
 * App-wide 404 fallback. Renders inside the root layout (so the bottom nav is
 * present) and always offers an escape hatch — so a deleted set/exercise/cycle
 * or a stale link never dead-ends the user on a bare "page not found".
 */
export default function NotFound() {
  return (
    <div className="h-[100dvh] flex flex-col items-center justify-center px-8 text-center pb-nav-safe">
      <p className="text-5xl font-bold tracking-tight">404</p>
      <h1 className="mt-3 text-lg font-semibold">This page isn&apos;t here anymore</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        It may have been deleted or moved. Let&apos;s get you back on track.
      </p>
      <div className="mt-8 flex flex-col gap-3 w-full max-w-xs">
        <Link
          href="/"
          className="w-full rounded-xl bg-primary py-3 text-base font-semibold text-primary-foreground active:scale-95 transition-all"
        >
          Back to Home
        </Link>
        <Link
          href="/programs"
          className="w-full rounded-xl bg-muted py-3 text-base font-semibold text-foreground active:scale-95 transition-all"
        >
          View Programs
        </Link>
      </div>
    </div>
  );
}
