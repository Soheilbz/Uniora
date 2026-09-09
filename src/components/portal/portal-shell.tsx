import { GraduationCap, LogOut, University, UserRound } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/actions/session.ts";
import { Button } from "@/components/ui/button.tsx";
import type { Viewer } from "@/lib/capabilities.ts";
import type { PortalSubjectKind } from "@/modules/portal/queries.ts";

export function PortalShell({
  viewer,
  kinds,
  words,
  children,
}: {
  viewer: Viewer;
  kinds: ReadonlySet<PortalSubjectKind>;
  words: { title: string; student: string; professor: string; signOut: string };
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-muted/20">
      <header className="sticky top-0 z-40 border-b border-border/80 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link href="/portal" className="flex min-w-0 items-center gap-2.5 font-semibold">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs">
              <University className="size-4.5" aria-hidden />
            </span>
            <span className="hidden truncate sm:inline">{words.title}</span>
          </Link>
          <nav className="ms-auto flex items-center gap-1" aria-label={words.title}>
            {kinds.has("student") ? (
              <Button
                variant="ghost"
                size="sm"
                nativeButton={false}
                render={
                  <Link href="/portal/student">
                    <GraduationCap aria-hidden />
                    {words.student}
                  </Link>
                }
              />
            ) : null}
            {kinds.has("professor") ? (
              <Button
                variant="ghost"
                size="sm"
                nativeButton={false}
                render={
                  <Link href="/portal/professor">
                    <UserRound aria-hidden />
                    {words.professor}
                  </Link>
                }
              />
            ) : null}
            <form action={signOut}>
              <Button variant="ghost" size="sm" type="submit">
                <LogOut aria-hidden />
                <span className="hidden sm:inline">{words.signOut}</span>
              </Button>
            </form>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-5 flex min-w-0 items-center justify-between gap-3 rounded-xl border border-border/70 bg-card px-4 py-3 shadow-xs">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{viewer.name}</p>
            <p className="text-xs text-muted-foreground">{words.title}</p>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
