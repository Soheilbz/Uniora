"use client";

import { Eye, EyeOff } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { toLocaleDigits } from "@/lib/digits";

export interface SensitiveRevealResult {
  ok: boolean;
  value?: string;
  message?: string;
}

export function SensitiveReveal({
  entityId,
  action,
  revealLabel,
  hideLabel,
  emptyLabel,
  locale,
}: {
  entityId: string;
  action: (
    previous: SensitiveRevealResult | null,
    formData: FormData,
  ) => Promise<SensitiveRevealResult>;
  revealLabel: string;
  hideLabel: string;
  emptyLabel: string;
  locale?: string;
}) {
  const [result, submit, pending] = useActionState(action, null);
  const [visible, setVisible] = useState(false);
  const available = result?.ok && result.value !== undefined;
  const value = result?.value ?? "";

  if (available && visible) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="font-mono tabular-nums" dir="ltr">
          {value ? (locale ? toLocaleDigits(value, locale) : value) : emptyLabel}
        </span>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={() => setVisible(false)}
          aria-label={hideLabel}
        >
          <EyeOff className="size-4" aria-hidden />
        </Button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono tracking-widest text-muted-foreground" aria-hidden>
        ••••••••
      </span>
      {available ? (
        <Button type="button" size="sm" variant="outline" onClick={() => setVisible(true)}>
          <Eye className="size-4" aria-hidden />
          {revealLabel}
        </Button>
      ) : (
        <form action={submit}>
          <input type="hidden" name="entityId" value={entityId} />
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            <Eye className="size-4" aria-hidden />
            {revealLabel}
          </Button>
        </form>
      )}
    </span>
  );
}
