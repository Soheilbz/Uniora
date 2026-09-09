"use client";
import { Fingerprint, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, useTransition } from "react";
import { SettingsCard } from "@/components/settings/setting-row.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { authClient } from "@/lib/auth-client.ts";

interface PasskeyView {
  id: string;
  name?: string | null;
  deviceType?: string | null;
  backedUp?: boolean | null;
  createdAt?: Date | string | null;
}
interface Words {
  title: string;
  description: string;
  name: string;
  add: string;
  adding: string;
  delete: string;
  empty: string;
  backedUp: string;
  device: string;
  error: string;
}
export function PasskeyManager({ words }: { words: Words }) {
  const [items, setItems] = useState<PasskeyView[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const refresh = useCallback(async () => {
    const result = await authClient.passkey.listUserPasskeys({});
    if (result.error) {
      setError(words.error);
      return;
    }
    setItems((result.data ?? []) as PasskeyView[]);
  }, [words.error]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const add = () =>
    start(async () => {
      setError(null);
      const passkeyOptions = {
        authenticatorAttachment: "platform" as const,
        ...(name.trim() ? { name: name.trim() } : {}),
      };
      const result = await authClient.passkey.addPasskey(passkeyOptions);
      if (result.error) {
        setError(words.error);
        return;
      }
      setName("");
      await refresh();
    });
  const remove = (id: string) =>
    start(async () => {
      setError(null);
      const result = await authClient.passkey.deletePasskey({ id });
      if (result.error) {
        setError(words.error);
        return;
      }
      await refresh();
    });
  return (
    <SettingsCard title={words.title} description={words.description}>
      <div className="grid gap-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            placeholder={words.name}
          />
          <Button type="button" disabled={pending} onClick={add}>
            <Fingerprint className="size-4" aria-hidden />
            {pending ? words.adding : words.add}
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="grid gap-2">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{words.empty}</p>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{item.name || "Passkey"}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.deviceType ? `${words.device}: ${item.deviceType}` : ""}
                    {item.backedUp ? ` · ${words.backedUp}` : ""}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={pending}
                  onClick={() => remove(item.id)}
                >
                  <Trash2 className="size-4" aria-hidden />
                  {words.delete}
                </Button>
              </div>
            ))
          )}
        </div>
      </div>
    </SettingsCard>
  );
}
