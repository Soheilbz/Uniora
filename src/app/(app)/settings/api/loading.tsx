export default function Loading() {
  return (
    <div className="grid gap-3" aria-busy="true">
      <div className="h-8 w-56 animate-pulse rounded bg-muted" />
      <div className="h-52 animate-pulse rounded-xl bg-muted" />
    </div>
  );
}
