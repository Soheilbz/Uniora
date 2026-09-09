import { FileSignature, Trash2 } from "lucide-react";
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
  createSigningConnectionAction,
  retireSigningConnectionAction,
  setSigningConnectionStatusAction,
} from "@/modules/integrations/signing-actions.ts";

interface Item {
  id: string;
  name: string;
  status: string;
  version: number;
  endpoint: string | null;
  providerName: string | null;
  mode: string;
  keyId: string | null;
  lastError: string | null;
}
interface Words {
  title: string;
  description: string;
  name: string;
  endpoint: string;
  provider: string;
  token: string;
  keyId: string;
  mode: string;
  detached: string;
  pades: string;
  create: string;
  active: string;
  disabled: string;
  enable: string;
  disable: string;
  retire: string;
  secret: string;
  empty: string;
}
export function SigningConnectionManager({ items, words }: { items: Item[]; words: Words }) {
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSignature className="size-4" aria-hidden />
            {words.title}
          </CardTitle>
          <CardDescription>{words.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={createSigningConnectionAction}
            className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"
          >
            <label className="grid gap-1 text-sm">
              <span>{words.name}</span>
              <Input name="name" required maxLength={120} />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{words.provider}</span>
              <Input name="providerName" required maxLength={100} />
            </label>
            <label className="grid gap-1 text-sm xl:col-span-2">
              <span>{words.endpoint}</span>
              <Input
                name="endpoint"
                required
                dir="ltr"
                placeholder="https://signer.example.edu/api/sign"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{words.token}</span>
              <Input name="token" type="password" required autoComplete="new-password" dir="ltr" />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{words.keyId}</span>
              <Input name="keyId" autoComplete="off" dir="ltr" />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{words.mode}</span>
              <select name="mode" className="h-9 rounded-lg border bg-background px-3">
                <option value="detached">{words.detached}</option>
                <option value="pades">{words.pades}</option>
              </select>
            </label>
            <div className="flex items-end">
              <Button type="submit">{words.create}</Button>
            </div>
          </form>
          <p className="mt-3 text-xs text-muted-foreground">{words.secret}</p>
        </CardContent>
      </Card>
      <div className="grid gap-3">
        {items.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">{words.empty}</CardContent>
          </Card>
        ) : (
          items.map((item) => (
            <Card key={item.id}>
              <CardContent className="flex flex-col gap-3 p-4 xl:flex-row xl:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap gap-2">
                    <p className="font-medium">{item.name}</p>
                    <Badge>{item.providerName ?? "—"}</Badge>
                    <Badge variant="secondary">{item.mode}</Badge>
                    <Badge variant={item.status === "active" ? "default" : "outline"}>
                      {item.status === "active" ? words.active : words.disabled}
                    </Badge>
                  </div>
                  {item.endpoint ? (
                    <code dir="ltr" className="mt-1 block break-all text-xs text-muted-foreground">
                      {item.endpoint}
                    </code>
                  ) : null}
                  {item.keyId ? (
                    <p className="mt-1 text-xs text-muted-foreground" dir="ltr">
                      key: {item.keyId}
                    </p>
                  ) : null}
                  {item.lastError ? (
                    <p className="mt-1 text-sm text-destructive">{item.lastError}</p>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <form action={setSigningConnectionStatusAction}>
                    <input type="hidden" name="id" value={item.id} />
                    <input type="hidden" name="version" value={item.version} />
                    <input
                      type="hidden"
                      name="active"
                      value={item.status === "active" ? "false" : "true"}
                    />
                    <Button size="sm" variant="outline">
                      {item.status === "active" ? words.disable : words.enable}
                    </Button>
                  </form>
                  <form action={retireSigningConnectionAction}>
                    <input type="hidden" name="id" value={item.id} />
                    <input type="hidden" name="version" value={item.version} />
                    <Button size="sm" variant="destructive">
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
    </div>
  );
}
