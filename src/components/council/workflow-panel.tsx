import { ArrowRight, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { submitCouncilDecisionTransition } from "@/modules/council/actions.ts";
import {
  type CouncilWorkflowState,
  nextCouncilStates,
} from "@/modules/council/application/workflow.ts";

const LABEL: Record<CouncilWorkflowState, string> = {
  draft: "Draft",
  submitted: "Submitted",
  administrative_review: "Administrative review",
  ready_for_council: "Ready for council",
  council_reviewed: "Council reviewed",
  approved: "Approved",
  revision_required: "Revision required",
  rejected: "Rejected",
  finalized: "Finalized",
};
export function CouncilWorkflowPanel({
  decisionId,
  state,
  version,
  canManage,
}: {
  decisionId: string;
  state: string;
  version: number;
  canManage: boolean;
}) {
  const next = nextCouncilStates(state);
  const terminal = next.length === 0;
  return (
    <section className="rounded-xl border bg-card p-4" aria-labelledby="workflow-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="workflow-heading" className="text-sm font-semibold">
            Workflow
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Current state:{" "}
            <span className="font-medium text-foreground">
              {LABEL[state as CouncilWorkflowState] ?? state}
            </span>
          </p>
        </div>
        {terminal && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <LockKeyhole className="size-3.5" aria-hidden />
            No further transition
          </span>
        )}
      </div>
      {canManage && next.length > 0 && (
        <div className="mt-4 grid gap-2">
          {next.map((target) => (
            <form
              key={target}
              action={submitCouncilDecisionTransition}
              className="flex flex-wrap items-center gap-2"
            >
              <input type="hidden" name="decisionId" value={decisionId} />
              <input type="hidden" name="target" value={target} />
              <input type="hidden" name="version" value={String(version)} />
              <Input
                name="reason"
                maxLength={1000}
                placeholder="Reason / note (optional)"
                className="min-w-48 flex-1"
              />
              <Button type="submit" variant={target === "rejected" ? "destructive" : "outline"}>
                {LABEL[target]}
                <ArrowRight className="size-3.5" aria-hidden />
              </Button>
            </form>
          ))}
        </div>
      )}
    </section>
  );
}
