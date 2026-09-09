"use client";

import { Copy, KeyRound, RefreshCw, ShieldX } from "lucide-react";
import { useActionState } from "react";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Input } from "@/components/ui/input.tsx";
import {
  createScimCredentialAction,
  revokeScimCredentialAction,
  rotateScimCredentialAction,
  type ScimCredentialActionState,
} from "@/modules/integrations/scim-actions.ts";
import { SCIM_SCOPES } from "@/modules/integrations/scim-types.ts";

interface Connection {
  id: string;
  name: string;
  status: string;
}
interface Credential {
  id: string;
  connectionId: string;
  connectionName: string;
  tokenPrefix: string;
  scopes: string[];
  status: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}
interface Words {
  title: string;
  description: string;
  newTitle: string;
  connection: string;
  scopes: string;
  expires: string;
  create: string;
  tokenTitle: string;
  tokenWarning: string;
  copy: string;
  active: string;
  revoked: string;
  rotate: string;
  revoke: string;
  lastUsed: string;
  never: string;
  empty: string;
  error: string;
}

const EMPTY: ScimCredentialActionState = {};

function SecretResult({ state, words }: { state: ScimCredentialActionState; words: Words }) {
  if (state.error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {state.error}
      </p>
    );
  if (!state.token) return null;
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
      <p className="font-medium">{words.tokenTitle}</p>
      <p className="mt-1 text-xs text-muted-foreground">{words.tokenWarning}</p>
      <div className="mt-2 flex gap-2">
        <Input readOnly value={state.token} dir="ltr" className="font-mono text-xs" />
        <Button
          type="button"
          variant="outline"
          onClick={() => navigator.clipboard.writeText(state.token ?? "")}
        >
          <Copy className="size-4" aria-hidden />
          {words.copy}
        </Button>
      </div>
    </div>
  );
}

function CreateCredential({ connections, words }: { connections: Connection[]; words: Words }) {
  const [state, action, pending] = useActionState(createScimCredentialAction, EMPTY);
  return (
    <form action={action} className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span>{words.connection}</span>
          <select name="connectionId" required className="h-9 rounded-lg border bg-background px-3">
            <option value="">—</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span>{words.expires}</span>
          <Input name="expiresAt" type="datetime-local" />
        </label>
      </div>
      <fieldset className="grid gap-2">
        <legend className="text-sm">{words.scopes}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {SCIM_SCOPES.map((scope) => (
            <label key={scope} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="scope"
                value={scope}
                defaultChecked={scope.endsWith("read")}
              />{" "}
              <code>{scope}</code>
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <Button type="submit" disabled={pending || connections.length === 0}>
          <KeyRound className="size-4" aria-hidden />
          {words.create}
        </Button>
      </div>
      <SecretResult state={state} words={words} />
    </form>
  );
}

function CredentialRow({ item, words }: { item: Credential; words: Words }) {
  const [state, rotateAction, pending] = useActionState(rotateScimCredentialAction, EMPTY);
  return (
    <div className="grid gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{item.connectionName}</p>
            <Badge variant={item.status === "active" ? "default" : "outline"}>
              {item.status === "active" ? words.active : words.revoked}
            </Badge>
          </div>
          <code className="mt-1 block text-xs text-muted-foreground" dir="ltr">
            {item.tokenPrefix}…
          </code>
          <p className="mt-1 text-xs text-muted-foreground">{item.scopes.join(", ")}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {words.lastUsed}: {item.lastUsedAt ?? words.never}
          </p>
        </div>
        {item.status === "active" ? (
          <div className="flex flex-wrap gap-2">
            <form action={rotateAction}>
              <input type="hidden" name="id" value={item.id} />
              <input type="hidden" name="connectionId" value={item.connectionId} />
              {item.scopes.map((scope) => (
                <input key={scope} type="hidden" name="scope" value={scope} />
              ))}
              {item.expiresAt ? (
                <input
                  type="hidden"
                  name="expiresAt"
                  value={new Date(item.expiresAt).toISOString().slice(0, 16)}
                />
              ) : null}
              <Button type="submit" size="sm" variant="outline" disabled={pending}>
                <RefreshCw className="size-4" aria-hidden />
                {words.rotate}
              </Button>
            </form>
            <form action={revokeScimCredentialAction}>
              <input type="hidden" name="id" value={item.id} />
              <Button type="submit" size="sm" variant="destructive">
                <ShieldX className="size-4" aria-hidden />
                {words.revoke}
              </Button>
            </form>
          </div>
        ) : null}
      </div>
      <SecretResult state={state} words={words} />
    </div>
  );
}

export function ScimCredentialManager({
  connections,
  credentials,
  words,
}: {
  connections: Connection[];
  credentials: Credential[];
  words: Words;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{words.title}</CardTitle>
        <CardDescription>{words.description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div>
          <p className="mb-3 text-sm font-medium">{words.newTitle}</p>
          <CreateCredential connections={connections} words={words} />
        </div>
        <div className="grid gap-2">
          {credentials.length ? (
            credentials.map((item) => <CredentialRow key={item.id} item={item} words={words} />)
          ) : (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              {words.empty}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
