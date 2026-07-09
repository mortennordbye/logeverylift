/**
 * Plain rectangular shimmer placeholder. Compose into route-level
 * `loading.tsx` files to give the user something to look at while the
 * Server Component data resolves.
 */
export function Skeleton({
  className = "",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`animate-pulse bg-muted rounded ${className}`}
      style={style}
      aria-hidden="true"
    />
  );
}
