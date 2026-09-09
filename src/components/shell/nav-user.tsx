"use client";

import { LogOut, MoreVertical, UserCog } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";

/**
 * Who is signed in, at the foot of the rail.
 *
 * A menu rather than a bare "sign out" button, because sign-out is not the only
 * thing somebody wants from their own name — the profile is the other, and a
 * lone destructive control at the bottom of the rail is a control people click
 * by accident on the way to something else.
 *
 * The initials rather than a photograph: this application has no avatar
 * upload, and a generic silhouette repeated down a list of operators
 * distinguishes nobody.
 */
export function NavUser({
  name,
  roleName,
  profileLabel,
  signOutLabel,
  menuLabel,
  onSignOut,
}: {
  name: string;
  roleName: string | null;
  profileLabel: string;
  signOutLabel: string;
  menuLabel: string;
  onSignOut: () => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  const role = roleName && roleName !== name ? roleName : null;

  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("");

  function submitSignOut() {
    if (pending) return;
    startTransition(async () => {
      await onSignOut();
    });
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                aria-label={`${menuLabel}: ${name}`}
                className="data-[state=open]:bg-sidebar-accent hover:bg-sidebar-accent/80 transition-colors rounded-xl p-2"
              >
                <Avatar className="size-8.5 rounded-lg border border-sidebar-border shadow-2xs">
                  <AvatarFallback className="rounded-lg bg-primary/10 text-xs font-bold text-sidebar-foreground">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="grid min-w-0 flex-1 text-start leading-tight">
                  <span className="truncate text-sm font-bold text-sidebar-foreground">{name}</span>
                  {role && (
                    <span className="truncate text-[11px] font-medium text-sidebar-foreground/70">
                      {role}
                    </span>
                  )}
                </div>
                <MoreVertical className="ms-auto size-4 text-sidebar-foreground/70" aria-hidden />
              </SidebarMenuButton>
            }
          />
          <DropdownMenuContent
            align="end"
            side="top"
            className="w-60 rounded-xl border border-border/80 bg-popover/95 p-1.5 shadow-xl backdrop-blur-md"
          >
            <DropdownMenuLabel className="font-normal p-2">
              <div className="flex items-center gap-2.5">
                <Avatar className="size-9 rounded-lg border border-border shadow-2xs">
                  <AvatarFallback className="rounded-lg bg-primary/10 text-xs font-bold text-foreground">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="grid min-w-0 flex-1 leading-tight">
                  <span className="truncate text-sm font-bold text-foreground">{name}</span>
                  {role && (
                    <span className="truncate text-[11px] font-medium text-primary mt-0.5">
                      {role}
                    </span>
                  )}
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="my-1" />
            <DropdownMenuItem
              render={
                <Link
                  href="/settings"
                  className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium cursor-pointer"
                />
              }
            >
              <UserCog className="size-4 text-muted-foreground" aria-hidden />
              <span>{profileLabel}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="my-1" />
            <DropdownMenuItem
              variant="destructive"
              onClick={submitSignOut}
              disabled={pending}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-semibold cursor-pointer text-destructive focus:bg-destructive/10"
            >
              <LogOut className="size-4" aria-hidden />
              <span>{signOutLabel}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
