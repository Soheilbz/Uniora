"use client";

import { Award } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ActionResult } from "@/lib/register/action-result.ts";
import { cn } from "@/lib/utils";

/**
 * Who came to a workshop, and who has been given a certificate.
 *
 * A client component for one reason: marking attendance is a *per-row* action
 * taken live, with the register open on a laptop in the room while people
 * arrive. A form that made somebody save the whole workshop to record one
 * arrival is a form they would stop using and go back to paper.
 */

export interface ParticipantView {
  id: string;
  version: number;
  name: string;
  studentId: string | null;
  studentNumber: string | null;
  affiliation: string | null;
  attendanceStatus: string;
  attendanceLabel: string;
  attendanceTone: number | null;
  paymentLabel: string | null;
  certificateNumber: string | null;
}

const TONES = [
  "border-info-subtle-border bg-info-subtle text-info-subtle-foreground",
  "border-success-subtle-border bg-success-subtle text-success-subtle-foreground",
  "border-warning-subtle-border bg-warning-subtle text-warning-subtle-foreground",
  "border-danger-subtle-border bg-danger-subtle text-danger-subtle-foreground",
];

export function ParticipantList({
  participants,
  canManage,
  setAttendance,
  issueCertificates,
  workshopId,
  pendingCertificates,
  certificateIssuanceAllowed,
  attendanceOptions,
}: {
  participants: ParticipantView[];
  canManage: boolean;
  setAttendance: (previous: ActionResult | null, form: FormData) => Promise<ActionResult>;
  issueCertificates: (previous: ActionResult | null, form: FormData) => Promise<ActionResult>;
  workshopId: string;
  /** How many attended and hold no certificate — what the button would issue. */
  pendingCertificates: number;
  /** Certificates are an assertion that a workshop actually took place. */
  certificateIssuanceAllowed: boolean;
  attendanceOptions: { value: string; label: string }[];
}) {
  const t = useTranslations("workshops");
  const common = useTranslations("common");
  const say = useTranslations();
  const [markResult, mark, marking] = useActionState(setAttendance, null);
  const [issueResult, issue, issuing] = useActionState(issueCertificates, null);
  const [, startTransition] = useTransition();

  /* These are row-level actions rather than forms with an inline error area.
     A refused attendance change or certificate issue must not disappear just
     because the table re-rendered unchanged. */
  useEffect(() => {
    if (markResult && !markResult.ok) {
      toast.error(markResult.message ? say(markResult.message) : common("formSaveFailed"));
    }
  }, [markResult, say, common]);

  useEffect(() => {
    if (issueResult && !issueResult.ok) {
      toast.error(issueResult.message ? say(issueResult.message) : common("formSaveFailed"));
    }
  }, [issueResult, say, common]);

  if (participants.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("noParticipants")}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {canManage && (
        <div data-print-hide className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            /*
             * Disabled when there is nobody to issue to, and it says which — a
             * button that does nothing when pressed teaches people it is broken.
             */
            disabled={!certificateIssuanceAllowed || pendingCertificates === 0 || issuing}
            title={!certificateIssuanceAllowed ? t("issueHeldOnly") : undefined}
            onClick={() => {
              const form = new FormData();
              form.set("workshopId", workshopId);
              startTransition(() => issue(form));
            }}
          >
            <Award className="size-4" aria-hidden />
            {!certificateIssuanceAllowed
              ? t("issueHeldOnly")
              : pendingCertificates === 0
                ? t("issueNone")
                : t("issueAll")}
          </Button>
        </div>
      )}

      <div className="w-full rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("participants")}</TableHead>
              <TableHead>{t("attendance")}</TableHead>
              <TableHead>{t("field.cost")}</TableHead>
              <TableHead>{t("certificate")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {participants.map((participant) => (
              <TableRow key={participant.id}>
                <TableCell>
                  <div className="flex flex-col">
                    {/*
                     * A student links to their record; somebody from outside has
                     * no record to link to, and is marked as such rather than
                     * left looking like a student whose link is broken.
                     */}
                    {participant.studentId ? (
                      <Link
                        href={`/students/${participant.studentId}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {participant.name}
                      </Link>
                    ) : (
                      <span className="flex items-center gap-2 font-medium">
                        {participant.name}
                        <Badge variant="outline" className="font-normal text-muted-foreground">
                          {t("external")}
                        </Badge>
                      </span>
                    )}
                    <span className="numeric text-xs text-muted-foreground">
                      {participant.studentNumber ?? participant.affiliation}
                    </span>
                  </div>
                </TableCell>

                <TableCell>
                  {canManage ? (
                    <Select
                      value={participant.attendanceStatus}
                      disabled={marking}
                      onValueChange={(status) => {
                        if (!status || status === participant.attendanceStatus) return;
                        const form = new FormData();
                        form.set("participantId", participant.id);
                        form.set("version", String(participant.version));
                        form.set("status", status);
                        startTransition(() => mark(form));
                      }}
                    >
                      <SelectTrigger
                        className="h-8 min-w-32 text-xs"
                        aria-label={`${t("attendance")} — ${participant.name}`}
                      >
                        <SelectValue>
                          {(current: string) =>
                            attendanceOptions.find((option) => option.value === current)?.label ??
                            participant.attendanceLabel
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {attendanceOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge
                      variant="outline"
                      className={cn(
                        "font-normal",
                        participant.attendanceTone !== null &&
                          TONES[participant.attendanceTone % TONES.length],
                      )}
                    >
                      {participant.attendanceLabel}
                    </Badge>
                  )}
                </TableCell>

                <TableCell className="text-sm text-muted-foreground">
                  {participant.paymentLabel ?? common("notRecorded")}
                </TableCell>

                <TableCell>
                  {participant.certificateNumber ? (
                    <span className="numeric text-sm" dir="ltr">
                      {participant.certificateNumber}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">{t("notIssued")}</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
