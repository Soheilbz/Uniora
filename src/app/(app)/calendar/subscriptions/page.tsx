import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { applicationOrigin } from "@/lib/application-origin.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { revokeCalendarSubscriptionAction } from "@/modules/calendar/subscription-actions.ts";
import { listCalendarSubscriptions } from "@/modules/calendar/subscriptions.ts";
import { SubscriptionForm } from "./subscription-form.tsx";

export default async function CalendarSubscriptionsPage() {
  const viewer = await requireCapability("calendar.view");
  const [t, rows] = await Promise.all([
    getTranslations("calendar"),
    listCalendarSubscriptions(viewer),
  ]);
  const origin = applicationOrigin();
  return (
    <div className="mx-auto grid max-w-4xl gap-5 p-4 sm:p-6">
      <header>
        <h1 className="text-lg font-semibold">{t("subscriptions.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subscriptions.subtitle")}</p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("subscriptions.new")}</CardTitle>
        </CardHeader>
        <CardContent>
          <SubscriptionForm
            origin={origin}
            words={{
              name: t("subscriptions.name"),
              create: t("subscriptions.create"),
              once: t("subscriptions.once"),
              error: t("subscriptions.error"),
            }}
          />
        </CardContent>
      </Card>
      <div className="grid gap-3">
        {rows.map((row) => (
          <Card key={row.id}>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
              <div>
                <strong>{row.name}</strong>
                <p className="text-xs text-muted-foreground" dir="ltr">
                  {row.tokenPrefix}… ·{" "}
                  {row.lastUsedAt ? row.lastUsedAt.toISOString() : t("subscriptions.neverUsed")}
                </p>
              </div>
              {!row.revokedAt ? (
                <form action={revokeCalendarSubscriptionAction}>
                  <input type="hidden" name="id" value={row.id} />
                  <Button type="submit" size="sm" variant="outline">
                    {t("subscriptions.revoke")}
                  </Button>
                </form>
              ) : (
                <span className="text-xs text-muted-foreground">{t("subscriptions.revoked")}</span>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      <Button
        variant="ghost"
        nativeButton={false}
        render={<Link href="/calendar">{t("subscriptions.back")}</Link>}
      />
    </div>
  );
}
