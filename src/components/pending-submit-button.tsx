"use client";

import { LoaderCircle } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

/**
 * A submit control that reflects the status of its nearest parent form.
 *
 * Server Actions can otherwise be submitted repeatedly while navigation is
 * still pending. Besides looking broken, that creates avoidable duplicate
 * work and duplicate audit attempts. Keeping this in one tiny client boundary
 * lets Server Components keep their forms while the browser still gets an
 * honest pending state.
 */
export function PendingSubmitButton({
  children,
  pendingChildren,
  disabled,
  ...props
}: Omit<ComponentProps<typeof Button>, "type"> & {
  children: ReactNode;
  pendingChildren?: ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      {...props}
      type="submit"
      disabled={disabled || pending}
      aria-disabled={disabled || pending || undefined}
      aria-busy={pending || undefined}
    >
      {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
      {pending ? (pendingChildren ?? children) : children}
    </Button>
  );
}
