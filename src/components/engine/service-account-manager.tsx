"use client";

import { Copy, KeyRound, RefreshCw, ShieldOff } from "lucide-react";
import { useActionState } from "react";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Input } from "@/components/ui/input.tsx";
import {
  changeServiceAccountStatusAction,
  createServiceAccountAction,
  revokeServiceAccountAction,
  rotateServiceAccountAction,
  type ServiceAccountActionState,
} from "@/modules/integrations/service-account-actions.ts";

interface ExistingAccount {
  id: string;
  name: string;
  description: string | null;
  status: string;
  capabilities: string[];
  tokenPrefix: string;
  rateLimitPerMinute: number;
  expiresAt: string | null;
  lastUsedAt: string | null;
  rotatedAt: string | null;
  createdAt: string;
  version: number;
}

interface CapabilityOption {
  value: string;
  label: string;
}

interface Words {
  newTitle: string;
  name: string;
  description: string;
  scopes: string;
  rateLimit: string;
  expiresOn: string;
  create: string;
  tokenTitle: string;
  tokenWarning: string;
  copy: string;
  active: string;
  suspended: string;
  suspend: string;
  resume: string;
  rotate: string;
  revoke: string;
  prefix: string;
  lastUsed: string;
  never: string;
  expires: string;
  noExpiry: string;
  invalid: string;
  stale: string;
  failed: string;
}

const INITIAL: ServiceAccountActionState = { ok: false };

function SecretResult({ state, words }: { state: ServiceAccountActionState; words: Words }) {
  if (!state.token)
    return state.error ? (
      <p role="alert" className="text-sm text-destructive">
        {words[state.error]}
      </p>
    ) : null;
  return (
    <div className="grid gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3">
      <div className="flex items-center gap-2 font-medium">
        <KeyRound className="size-4" aria-hidden />
        {words.tokenTitle}
      </div>
      <p className="text-sm text-muted-foreground">{words.tokenWarning}</p>
      <div className="flex gap-2">
        <Input
          value={state.token}
          readOnly
          dir="ltr"
          className="font-mono text-xs"
          aria-label={words.tokenTitle}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => navigator.clipboard.writeText(state.token ?? "")}
          aria-label={words.copy}
        >
          <Copy className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

function RotateAccount({ account, words }: { account: ExistingAccount; words: Words }) {
  const [state, action, pending] = useActionState(rotateServiceAccountAction, INITIAL);
  return (
    <div className="grid gap-2">
      <form action={action}>
        <input type="hidden" name="id" value={account.id} />
        <input type="hidden" name="version" value={account.version} />
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          <RefreshCw className="size-4" aria-hidden />
          {words.rotate}
        </Button>
      </form>
      <SecretResult state={state} words={words} />
    </div>
  );
}

export function ServiceAccountManager({
  accounts,
  capabilityOptions,
  words,
}: {
  accounts: ExistingAccount[];
  capabilityOptions: CapabilityOption[];
  words: Words;
}) {
  const [state, action, pending] = useActionState(createServiceAccountAction, INITIAL);

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{words.newTitle}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <form action={action} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="grid gap-1 text-sm">
              <span>{words.name}</span>
              <Input name="name" required maxLength={120} />
            </label>
            <label className="grid gap-1 text-sm md:col-span-1 xl:col-span-2">
              <span>{words.description}</span>
              <Input name="description" maxLength={500} />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{words.rateLimit}</span>
              <Input
                name="rateLimitPerMinute"
                type="number"
                min="10"
                max="1000"
                defaultValue="120"
                required
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{words.expiresOn}</span>
              <Input name="expiresOn" type="date" />
            </label>
            <fieldset className="grid gap-2 md:col-span-2 xl:col-span-4">
              <legend className="text-sm">{words.scopes}</legend>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {capabilityOptions.map((option) => (
                  <label
                    key={option.value}
                    className="flex items-start gap-2 rounded-lg border p-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      name="capability"
                      value={option.value}
                      className="mt-1"
                    />
                    <span>
                      {option.label}
                      <code className="mt-0.5 block text-[11px] text-muted-foreground" dir="ltr">
                        {option.value}
                      </code>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="md:col-span-2 xl:col-span-4 flex justify-end">
              <Button type="submit" disabled={pending}>
                <KeyRound className="size-4" aria-hidden />
                {words.create}
              </Button>
            </div>
          </form>
          <SecretResult state={state} words={words} />
        </CardContent>
      </Card>

      <div className="grid gap-3">
        {accounts.map((account) => (
          <Card key={account.id}>
            <CardContent className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{account.name}</p>
                  <Badge variant={account.status === "active" ? "default" : "outline"}>
                    {account.status === "active" ? words.active : words.suspended}
                  </Badge>
                  <code className="text-xs text-muted-foreground" dir="ltr">
                    {account.tokenPrefix}…
                  </code>
                </div>
                {account.description ? (
                  <p className="mt-1 text-sm text-muted-foreground">{account.description}</p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-1">
                  {account.capabilities.map((capability) => (
                    <Badge key={capability} variant="secondary" className="font-mono text-[10px]">
                      {capability}
                    </Badge>
                  ))}
                </div>
                <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3">
                  <div>
                    <dt>{words.rateLimit}</dt>
                    <dd className="font-medium text-foreground">
                      {account.rateLimitPerMinute}/min
                    </dd>
                  </div>
                  <div>
                    <dt>{words.lastUsed}</dt>
                    <dd className="font-medium text-foreground">
                      {account.lastUsedAt ?? words.never}
                    </dd>
                  </div>
                  <div>
                    <dt>{words.expires}</dt>
                    <dd className="font-medium text-foreground">
                      {account.expiresAt ?? words.noExpiry}
                    </dd>
                  </div>
                </dl>
              </div>
              <div className="flex flex-wrap items-start gap-2">
                <form action={changeServiceAccountStatusAction}>
                  <input type="hidden" name="id" value={account.id} />
                  <input type="hidden" name="version" value={account.version} />
                  <input
                    type="hidden"
                    name="status"
                    value={account.status === "active" ? "suspended" : "active"}
                  />
                  <Button type="submit" size="sm" variant="outline">
                    <ShieldOff className="size-4" aria-hidden />
                    {account.status === "active" ? words.suspend : words.resume}
                  </Button>
                </form>
                <RotateAccount account={account} words={words} />
                <form action={revokeServiceAccountAction}>
                  <input type="hidden" name="id" value={account.id} />
                  <input type="hidden" name="version" value={account.version} />
                  <Button type="submit" size="sm" variant="destructive">
                    {words.revoke}
                  </Button>
                </form>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
