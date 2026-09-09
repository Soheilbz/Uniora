import { Cable, Link2, LockKeyhole, ShieldCheck, Trash2 } from "lucide-react";
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
  createEnterpriseConnectionAction,
  createExternalIdentityLinkAction,
  retireEnterpriseConnectionAction,
  retireExternalIdentityLinkAction,
  setEnterpriseConnectionStatusAction,
} from "@/modules/integrations/connection-actions.ts";

interface ConnectionRow {
  id: string;
  kind: string;
  name: string;
  status: string;
  version: number;
  endpoint: string | null;
  domain: string | null;
  runtimeAvailable: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
}

interface IdentityRow {
  id: string;
  connectionId: string;
  providerId: string;
  protocol: string;
  issuer: string;
  subject: string;
  userId: string;
  username: string | null;
  displayName: string;
  status: string;
  version: number;
}

interface Words {
  title: string;
  description: string;
  newTitle: string;
  kind: string;
  name: string;
  endpoint: string;
  identifier: string;
  secret: string;
  domain: string;
  baseDn: string;
  usernameAttribute: string;
  metadata: string;
  metadataHint: string;
  create: string;
  active: string;
  disabled: string;
  runtimeReady: string;
  runtimeMissing: string;
  enable: string;
  disable: string;
  retire: string;
  protected: string;
  noConnections: string;
  identitiesTitle: string;
  identitiesDescription: string;
  identityConnection: string;
  identityUsername: string;
  identityIssuer: string;
  identitySubject: string;
  provision: string;
  noIdentities: string;
  identityRule: string;
  kinds: Record<string, string>;
}

export function EnterpriseConnectionManager({
  connections,
  identities,
  words,
}: {
  connections: ConnectionRow[];
  identities: IdentityRow[];
  words: Words;
}) {
  const identityConnections = connections.filter(
    (item) =>
      item.kind === "identity_oidc" || item.kind === "identity_saml" || item.kind === "scim",
  );

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4" aria-hidden />
            {words.title}
          </CardTitle>
          <CardDescription>{words.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={createEnterpriseConnectionAction}
            className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"
          >
            <label className="grid gap-1 text-sm">
              <span>{words.kind}</span>
              <select
                name="kind"
                required
                defaultValue="identity_oidc"
                className="h-9 rounded-lg border bg-background px-3"
              >
                {Object.entries(words.kinds).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span>{words.name}</span>
              <Input name="name" required maxLength={120} />
            </label>
            <label className="grid gap-1 text-sm xl:col-span-2">
              <span>{words.endpoint}</span>
              <Input name="endpoint" dir="ltr" placeholder="https://idp.example.edu/" />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{words.identifier}</span>
              <Input name="identifier" dir="ltr" autoComplete="off" />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{words.secret}</span>
              <Input name="secret" type="password" dir="ltr" autoComplete="new-password" />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{words.domain}</span>
              <Input name="domain" dir="ltr" placeholder="example.edu" />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{words.baseDn}</span>
              <Input name="baseDn" dir="ltr" placeholder="dc=example,dc=edu" />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{words.usernameAttribute}</span>
              <Input name="usernameAttribute" dir="ltr" placeholder="uid" />
            </label>
            <label className="grid gap-1 text-sm md:col-span-2 xl:col-span-4">
              <span>{words.metadata}</span>
              <textarea
                name="metadata"
                dir="ltr"
                rows={5}
                maxLength={250_000}
                className="min-h-28 rounded-lg border bg-background px-3 py-2 font-mono text-xs"
                placeholder={words.metadataHint}
              />
            </label>
            <div className="flex items-end xl:col-span-3">
              <Button type="submit">
                <Cable className="size-4" aria-hidden />
                {words.create}
              </Button>
            </div>
          </form>
          <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
            <LockKeyhole className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {words.protected}
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-3">
        {connections.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              {words.noConnections}
            </CardContent>
          </Card>
        ) : (
          connections.map((item) => (
            <Card key={item.id}>
              <CardContent className="grid gap-3 p-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{item.name}</p>
                    <Badge variant="secondary">{words.kinds[item.kind] ?? item.kind}</Badge>
                    <Badge variant={item.status === "active" ? "default" : "outline"}>
                      {item.status === "active" ? words.active : words.disabled}
                    </Badge>
                    <Badge variant={item.runtimeAvailable ? "outline" : "destructive"}>
                      {item.runtimeAvailable ? words.runtimeReady : words.runtimeMissing}
                    </Badge>
                  </div>
                  {item.endpoint ? (
                    <code dir="ltr" className="mt-1 block break-all text-xs text-muted-foreground">
                      {item.endpoint}
                    </code>
                  ) : null}
                  {item.domain ? (
                    <p className="mt-1 text-xs text-muted-foreground" dir="ltr">
                      {item.domain}
                    </p>
                  ) : null}
                  {item.lastError ? (
                    <p className="mt-2 text-sm text-destructive">{item.lastError}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <form action={setEnterpriseConnectionStatusAction}>
                    <input type="hidden" name="id" value={item.id} />
                    <input type="hidden" name="version" value={item.version} />
                    <input
                      type="hidden"
                      name="active"
                      value={item.status === "active" ? "false" : "true"}
                    />
                    <Button
                      type="submit"
                      size="sm"
                      variant="outline"
                      disabled={item.status !== "active" && !item.runtimeAvailable}
                    >
                      {item.status === "active" ? words.disable : words.enable}
                    </Button>
                  </form>
                  <form action={retireEnterpriseConnectionAction}>
                    <input type="hidden" name="id" value={item.id} />
                    <input type="hidden" name="version" value={item.version} />
                    <Button type="submit" size="sm" variant="destructive">
                      <Trash2 className="size-4" aria-hidden />
                      {words.retire}
                    </Button>
                  </form>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="size-4" aria-hidden />
            {words.identitiesTitle}
          </CardTitle>
          <CardDescription>{words.identitiesDescription}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <form
            action={createExternalIdentityLinkAction}
            className="grid gap-3 md:grid-cols-2 xl:grid-cols-5"
          >
            <label className="grid gap-1 text-sm">
              <span>{words.identityConnection}</span>
              <select
                name="connectionId"
                required
                className="h-9 rounded-lg border bg-background px-3"
                disabled={identityConnections.length === 0}
              >
                <option value="">—</option>
                {identityConnections.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span>{words.identityUsername}</span>
              <Input name="username" required dir="ltr" autoCapitalize="none" />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{words.identityIssuer}</span>
              <Input name="issuer" dir="ltr" />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{words.identitySubject}</span>
              <Input name="subject" required dir="ltr" />
            </label>
            <div className="flex items-end">
              <Button type="submit" disabled={identityConnections.length === 0}>
                {words.provision}
              </Button>
            </div>
          </form>
          <p className="text-xs text-muted-foreground">{words.identityRule}</p>
          {identities.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              {words.noIdentities}
            </p>
          ) : (
            <div className="grid gap-2">
              {identities.map((item) => (
                <div
                  key={item.id}
                  className="grid gap-2 rounded-lg border p-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{item.displayName}</p>
                      <Badge variant="secondary">{item.protocol.toUpperCase()}</Badge>
                      <Badge variant={item.status === "active" ? "default" : "outline"}>
                        {item.status}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground" dir="ltr">
                      {item.username ?? item.userId}
                    </p>
                    <code
                      className="mt-1 block break-all text-[11px] text-muted-foreground"
                      dir="ltr"
                    >
                      {item.issuer} · {item.subject}
                    </code>
                  </div>
                  <form action={retireExternalIdentityLinkAction}>
                    <input type="hidden" name="id" value={item.id} />
                    <input type="hidden" name="version" value={item.version} />
                    <Button type="submit" size="sm" variant="destructive">
                      <Trash2 className="size-4" aria-hidden />
                      {words.retire}
                    </Button>
                  </form>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
