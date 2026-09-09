"use client";

import { ArrowDown, ArrowUp, Check, Plus, Trash2, UserCheck, UserX } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { CouncilDirectoryCombobox } from "@/components/council/directory-combobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { DirectoryEntry, RosterSeat } from "@/modules/council/roster.ts";

export interface CouncilAttendanceEditorProps {
  seats: RosterSeat[];
  directory: DirectoryEntry[];
  initialParticipants?: string[];
  initialAbsentees?: string[];
  initialSubstitutions?: Record<string, string>;
  error?: string | undefined;
}

export function CouncilAttendanceEditor({
  seats,
  directory,
  initialParticipants = [],
  initialAbsentees = [],
  initialSubstitutions = {},
  error,
}: CouncilAttendanceEditorProps) {
  const t = useTranslations("council.attendanceEditor");
  // Status for each standing member: "present" | "absent"
  const [statuses, setStatuses] = useState<Record<string, "present" | "absent">>(() => {
    const initial: Record<string, "present" | "absent"> = {};
    for (const seat of seats) {
      if (initialAbsentees.includes(seat.memberName)) {
        initial[seat.memberName] = "absent";
      } else {
        initial[seat.memberName] = "present";
      }
    }
    return initial;
  });

  // Map of substitutions: { [seatMemberName]: substituteProfessorName }
  const [substitutions, setSubstitutions] = useState<Record<string, string>>(
    () => initialSubstitutions || {},
  );

  // Ordered list of attendees for print ordering
  const [participants, setParticipants] = useState<string[]>(() => {
    if (initialParticipants.length > 0) {
      const normalised = initialParticipants.map((person) => {
        for (const [member, deputy] of Object.entries(initialSubstitutions)) {
          if (person === `${deputy} (جانشین ${member})`) return deputy;
        }
        return person;
      });
      return [...new Set(normalised)];
    }
    return seats
      .filter((s) => (statuses[s.memberName] ?? "present") === "present")
      .map((s) => s.memberName);
  });

  // Additional attendee input
  const [customAttendee, setCustomAttendee] = useState("");

  // Sync participants and absentees when statuses or substitutions change
  const syncAttendance = (
    nextStatuses: Record<string, "present" | "absent">,
    nextSubs: Record<string, string>,
  ) => {
    setStatuses(nextStatuses);
    setSubstitutions(nextSubs);

    // Recompute attendees list
    const newAttendees: string[] = [];
    for (const seat of seats) {
      const status = nextStatuses[seat.memberName] ?? "present";
      if (status === "present") {
        newAttendees.push(seat.memberName);
      } else if (nextSubs[seat.memberName]) {
        // Substitute represents this member
        const deputy = nextSubs[seat.memberName];
        if (deputy && !newAttendees.includes(deputy)) newAttendees.push(deputy);
      }
    }

    // Keep any custom attendees already in participants
    setParticipants((prev) => {
      const managed = new Set([
        ...seats.map((seat) => seat.memberName),
        ...Object.values(substitutions),
        ...Object.values(nextSubs),
      ]);
      const customs = prev.filter((person) => {
        if (managed.has(person)) return false;
        return !seats.some((seat) => person.endsWith(`(جانشین ${seat.memberName})`));
      });
      return [...new Set([...newAttendees, ...customs])];
    });
  };

  const toggleMemberStatus = (memberName: string, newStatus: "present" | "absent") => {
    const nextStatuses = { ...statuses, [memberName]: newStatus };
    const nextSubs = { ...substitutions };
    if (newStatus === "present") {
      delete nextSubs[memberName];
    }
    syncAttendance(nextStatuses, nextSubs);
  };

  const setMemberSubstitute = (memberName: string, substituteName: string | null) => {
    const nextSubs = { ...substitutions };
    if (substituteName) {
      nextSubs[memberName] = substituteName;
    } else {
      delete nextSubs[memberName];
    }
    syncAttendance(statuses, nextSubs);
  };

  // Reorder attendee
  const moveAttendee = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= participants.length) return;
    const next = [...participants];
    const item = next[index];
    if (!item) return;
    next.splice(index, 1);
    next.splice(targetIndex, 0, item);
    setParticipants(next);
  };

  const removeAttendee = (index: number) => {
    setParticipants((prev) => prev.filter((_, i) => i !== index));
  };

  const addCustomAttendee = () => {
    const trimmed = customAttendee.trim();
    if (!trimmed || participants.includes(trimmed)) return;
    setParticipants((prev) => [...prev, trimmed]);
    setCustomAttendee("");
  };

  // Absence is a fact about the standing member. A substitute fills the seat
  // but does not make the member present; the substitution map records that
  // separately and the printed roll suppresses represented absences.
  const calculatedAbsentees = seats
    .filter((s) => (statuses[s.memberName] ?? "present") === "absent")
    .map((s) => s.memberName);

  const managedParticipants = new Set([
    ...seats
      .filter((seat) => (statuses[seat.memberName] ?? "present") === "present")
      .map((seat) => seat.memberName),
    ...Object.values(substitutions),
  ]);

  return (
    <div className="flex flex-col gap-6 rounded-xl border border-border/80 bg-card/85 p-4 sm:p-5 shadow-2xs backdrop-blur-xs sm:col-span-2 lg:col-span-3">
      {/* Hidden inputs posted to Server Action */}
      <input type="hidden" name="participants" value={participants.join("\n")} />
      <input type="hidden" name="absentees" value={calculatedAbsentees.join("\n")} />
      <input type="hidden" name="substitutions" value={JSON.stringify(substitutions)} />

      {error && (
        <p className="text-xs font-medium text-destructive" role="alert">
          {error}
        </p>
      )}

      {/* Header Info */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 pb-3.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-bold text-foreground">{t("title")}</span>
          <p className="text-xs text-muted-foreground">{t("hint")}</p>
        </div>

        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="border-success-subtle-border bg-success-subtle text-success-subtle-foreground font-semibold px-2.5 py-1"
          >
            <UserCheck className="size-3.5 me-1.5" />
            {t("presentCount", { count: participants.length })}
          </Badge>
          <Badge
            variant="outline"
            className="border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300 font-semibold px-2.5 py-1"
          >
            <UserX className="size-3.5 me-1.5" />
            {t("absentCount", { count: calculatedAbsentees.length })}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Column 1: Standing Members List & Status Switcher (7 cols) */}
        <div className="flex flex-col gap-3 lg:col-span-7">
          <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
            <span>{t("standingMembers", { count: seats.length })}</span>
          </span>

          <div className="flex flex-col divide-y divide-border/40 rounded-xl border border-border/70 bg-background/50 overflow-hidden">
            {seats.map((seat) => {
              const status = statuses[seat.memberName] ?? "present";
              const isAbsent = status === "absent";
              const substitute = substitutions[seat.memberName];

              return (
                <div
                  key={seat.id}
                  className={cn(
                    "flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 transition-colors",
                    isAbsent ? "bg-rose-500/5 hover:bg-rose-500/10" : "hover:bg-card/70",
                  )}
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-xs font-bold text-foreground">
                      {seat.memberName}
                    </span>
                    {isAbsent && substitute && (
                      <span className="text-[11px] font-medium text-success-subtle-foreground flex items-center gap-1">
                        <Check className="size-3" aria-hidden />
                        {t("substitute", { name: substitute })}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* Present / Absent Segmented Buttons */}
                    <fieldset
                      className="inline-flex rounded-lg border border-border/80 bg-muted/40 p-0.5"
                      aria-label={seat.memberName}
                    >
                      <button
                        type="button"
                        onClick={() => toggleMemberStatus(seat.memberName, "present")}
                        aria-pressed={!isAbsent}
                        className={cn(
                          "rounded-md px-2.5 py-1 text-xs font-semibold transition-all",
                          !isAbsent
                            ? "bg-success text-success-foreground shadow-xs"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {t("present")}
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleMemberStatus(seat.memberName, "absent")}
                        aria-pressed={isAbsent}
                        className={cn(
                          "rounded-md px-2.5 py-1 text-xs font-semibold transition-all",
                          isAbsent
                            ? "bg-danger text-danger-foreground shadow-xs"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {t("absent")}
                      </button>
                    </fieldset>

                    {/* Substitute Dropdown (shown only when absent) */}
                    {isAbsent && (
                      <div className="w-48">
                        <CouncilDirectoryCombobox
                          name={`substitute-${seat.memberName}`}
                          value={substitute ?? ""}
                          onChange={(val) => setMemberSubstitute(seat.memberName, val ? val : null)}
                          initialEntries={directory}
                          valueMode="name"
                          excludeNames={[seat.memberName]}
                          placeholder={t("chooseSubstitute")}
                          ariaLabel={`${t("chooseSubstitute")} — ${seat.memberName}`}
                          allowCustom
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Column 2: Printable Participants Order & Management (5 cols) */}
        <div className="flex flex-col gap-3 lg:col-span-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground">
              {t("participantsOrder", { count: participants.length })}
            </span>
            <span className="text-[11px] text-muted-foreground">{t("printOrderHint")}</span>
          </div>

          <div className="flex flex-col divide-y divide-border/40 rounded-xl border border-border/70 bg-background/50 p-1 max-h-80 overflow-y-auto">
            {participants.map((person, idx) => (
              <div
                key={person}
                className="flex items-center justify-between gap-2 p-2 rounded-lg transition-colors hover:bg-card/80"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="numeric size-5 shrink-0 rounded-md bg-muted/60 flex items-center justify-center text-[10px] font-bold text-muted-foreground">
                    {idx + 1}
                  </span>
                  <span className="truncate text-xs font-semibold text-foreground">{person}</span>
                </div>

                <div className="flex items-center gap-0.5 shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    disabled={idx === 0}
                    onClick={() => moveAttendee(idx, "up")}
                    aria-label={`${t("moveUp")} — ${person}`}
                    className="size-6 text-muted-foreground hover:text-foreground"
                  >
                    <ArrowUp className="size-3.5" aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    disabled={idx === participants.length - 1}
                    onClick={() => moveAttendee(idx, "down")}
                    aria-label={`${t("moveDown")} — ${person}`}
                    className="size-6 text-muted-foreground hover:text-foreground"
                  >
                    <ArrowDown className="size-3.5" aria-hidden />
                  </Button>
                  {!managedParticipants.has(person) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => removeAttendee(idx)}
                      aria-label={`${t("removeParticipant")} — ${person}`}
                      className="size-6 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Add custom attendee */}
          <div className="flex items-center gap-1.5 pt-1">
            <Input
              value={customAttendee}
              onChange={(e) => setCustomAttendee(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustomAttendee();
                }
              }}
              placeholder={t("otherPersonPlaceholder")}
              aria-label={t("otherPersonPlaceholder")}
              maxLength={200}
              className="h-8 text-xs bg-background/80"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addCustomAttendee}
              disabled={!customAttendee.trim()}
              className="h-8 shrink-0 text-xs gap-1"
            >
              <Plus className="size-3.5" aria-hidden />
              {t("add")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
