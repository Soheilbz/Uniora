"use client";

import { DomainError } from "@/components/engine/domain-error.tsx";

function RouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <DomainError reset={reset} />;
}

export default RouteError;
