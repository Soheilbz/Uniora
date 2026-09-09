"use client";

import { Button } from "@/components/ui/button.tsx";

function RouteError({ reset }: { reset: () => void }) {
  return (
    <div className="rounded-xl border border-destructive/30 p-5">
      <p className="text-sm text-destructive">Retention settings could not be loaded.</p>
      <Button className="mt-3" variant="outline" onClick={reset}>
        Retry
      </Button>
    </div>
  );
}

export default RouteError;
