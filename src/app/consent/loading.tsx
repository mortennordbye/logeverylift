/**
 * The consent page reads the session and the database, so under
 * cacheComponents it needs its own loading boundary. Without one, a
 * navigation to it (the home page sends every user here after a
 * CONSENT_VERSION raise) fails with "uncached data outside of <Suspense>".
 */
export default function ConsentLoading() {
  return (
    <div className="h-[100dvh] overflow-y-auto bg-background">
      <div className="mx-auto max-w-md px-6 pt-16 pb-16 flex flex-col gap-6">
        <div className="h-9 w-48 rounded-lg bg-muted animate-pulse" />
        <div className="h-16 rounded-lg bg-muted animate-pulse" />
      </div>
    </div>
  );
}
