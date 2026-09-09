import { AlertTriangle, CircleAlert, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

/**
 * A band that says something the reader has to know before acting.
 *
 * Wrapping the vendored `Alert` rather than adding variants to it: everything
 * under `components/ui` is replaced wholesale by `shadcn add`, so a `warning`
 * variant added there is a variant that disappears the next time the component
 * is updated. The three intents this product actually uses live here instead.
 *
 * An icon *and* a colour, always. Colour alone is invisible to a reader who
 * cannot distinguish it and to anybody printing in greyscale — and several of
 * the screens that use this print.
 */

/* The same subtle families the state chips use, so a warning band and a warning
   chip on one screen are the same amber rather than two near-misses. */
const INTENTS = {
  info: { icon: Info, className: "ui-state-info" },
  warning: { icon: AlertTriangle, className: "ui-state-warning" },
  danger: { icon: CircleAlert, className: "ui-state-danger" },
} as const;

export type NoticeIntent = keyof typeof INTENTS;

export function Notice({
  intent = "info",
  title,
  children,
  className,
}: {
  intent?: NoticeIntent;
  title: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const { icon: Icon, className: tone } = INTENTS[intent];

  return (
    <Alert className={cn(tone, className)}>
      <Icon className="size-4" aria-hidden />
      <AlertTitle>{title}</AlertTitle>
      {children && <AlertDescription className="text-current/85">{children}</AlertDescription>}
    </Alert>
  );
}
