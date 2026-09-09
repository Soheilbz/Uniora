import { DatabaseZap, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import {
  requestSystemSyncAction,
  setStagingDispositionAction,
} from "@/modules/integrations/system-sync-actions.ts";

interface Words {
  title: string;
  description: string;
  sync: string;
  active: string;
  disabled: string;
  runs: string;
  received: string;
  staged: string;
  errors: string;
  emptyRuns: string;
  staging: string;
  emptyStaging: string;
  ignore: string;
  restore: string;
}
export function SystemSyncManager({
  state,
  words,
}: {
  state: {
    connections: Array<{
      id: string;
      kind: string;
      name: string;
      status: string;
      lastSyncAt: string | null;
      lastError: string | null;
    }>;
    runs: Array<{
      id: string;
      connectionId: string;
      kind: string;
      status: string;
      received: number;
      staged: number;
      errorCount: number;
      publicError: string | null;
      startedAt: string | null;
      completedAt: string | null;
      createdAt: string;
    }>;
    staging: Array<{
      id: string;
      connectionId: string;
      sourceKey: string;
      entityType: string;
      payloadJson: string;
      status: string;
      updatedAt: string;
    }>;
  };
  words: Words;
}) {
  const names = new Map(state.connections.map((c) => [c.id, c.name]));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <DatabaseZap className="size-4" aria-hidden />
          {words.title}
        </CardTitle>
        <CardDescription>{words.description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid gap-2">
          {state.connections.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div>
                <div className="flex gap-2">
                  <p className="font-medium">{c.name}</p>
                  <Badge variant="secondary">{c.kind}</Badge>
                  <Badge variant={c.status === "active" ? "default" : "outline"}>
                    {c.status === "active" ? words.active : words.disabled}
                  </Badge>
                </div>
                {c.lastError ? (
                  <p className="mt-1 text-xs text-destructive">{c.lastError}</p>
                ) : null}
              </div>
              <form action={requestSystemSyncAction}>
                <input type="hidden" name="connectionId" value={c.id} />
                <Button size="sm" variant="outline" disabled={c.status !== "active"}>
                  <RefreshCw className="size-4" aria-hidden />
                  {words.sync}
                </Button>
              </form>
            </div>
          ))}
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">{words.runs}</p>
          {state.runs.length ? (
            <div className="grid gap-2">
              {state.runs.map((r) => (
                <div key={r.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap gap-2">
                    <strong>{names.get(r.connectionId) ?? r.kind}</strong>
                    <Badge variant="outline">{r.status}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {words.received}: {r.received} · {words.staged}: {r.staged} · {words.errors}:{" "}
                    {r.errorCount}
                  </p>
                  {r.publicError ? (
                    <p className="mt-1 text-xs text-destructive">{r.publicError}</p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{words.emptyRuns}</p>
          )}
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">{words.staging}</p>
          {state.staging.length ? (
            <div className="grid gap-2">
              {state.staging.map((r) => (
                <div
                  key={r.id}
                  className="grid gap-2 rounded-lg border p-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap gap-2">
                      <code>{r.sourceKey}</code>
                      <Badge variant="secondary">{r.entityType}</Badge>
                      <Badge variant="outline">{r.status}</Badge>
                    </div>
                    <code
                      dir="ltr"
                      className="mt-1 block max-h-20 overflow-hidden break-all text-[11px] text-muted-foreground"
                    >
                      {r.payloadJson}
                    </code>
                  </div>
                  <form action={setStagingDispositionAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <input
                      type="hidden"
                      name="disposition"
                      value={r.status === "ignored" ? "pending" : "ignored"}
                    />
                    <Button size="sm" variant="outline">
                      {r.status === "ignored" ? words.restore : words.ignore}
                    </Button>
                  </form>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{words.emptyStaging}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
