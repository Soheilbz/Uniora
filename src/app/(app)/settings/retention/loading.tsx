export default function Loading() {
  return (
    <div className="grid gap-4" aria-busy="true">
      <div className="h-16 animate-pulse rounded-xl bg-muted" />
      <div className="h-48 animate-pulse rounded-xl bg-muted" />
      <div className="h-48 animate-pulse rounded-xl bg-muted" />
    </div>
  );
}
