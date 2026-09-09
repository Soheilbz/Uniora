import { Skeleton } from "@/components/ui/skeleton.tsx";
export default function Loading() {
  return (
    <div className="grid gap-3">
      <Skeleton className="h-12 w-72" />
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
