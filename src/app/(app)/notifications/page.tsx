import { CheckCheck, Circle, ExternalLink, X } from "lucide-react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { PageBody } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toLocaleDigits } from "@/lib/digits.ts";
import { requireViewer } from "@/lib/viewer.ts";
import {
  dismissNotification,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/modules/notifications/actions.ts";
import { readNotifications } from "@/modules/notifications/queries.ts";

export async function generateMetadata() {
  const t = await getTranslations("notifications");
  return { title: t("title") };
}

export default async function NotificationsPage() {
  const viewer = await requireViewer();
  const [t, locale, items] = await Promise.all([
    getTranslations("notifications"),
    getLocale(),
    readNotifications(viewer, 100),
  ]);
  const unread = items.filter((item) => !item.readAt).length;

  return (
    <PageBody className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle", { count: unread })}</p>
        </div>
        {unread > 0 && (
          <form action={markAllNotificationsRead}>
            <Button type="submit" variant="outline" size="sm">
              <CheckCheck className="size-4" aria-hidden />
              {t("markAllRead")}
            </Button>
          </form>
        )}
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex min-h-40 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <CheckCheck className="size-7" aria-hidden />
            <p className="text-sm font-medium text-foreground">{t("emptyTitle")}</p>
            <p className="max-w-md text-sm">{t("emptyBody")}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <Card key={item.id} className={item.readAt ? "opacity-75" : "border-primary/30"}>
              <CardContent className="flex items-start gap-3 p-4">
                <Circle
                  className={
                    item.readAt
                      ? "mt-1 size-2 fill-muted text-muted"
                      : "mt-1 size-2 fill-primary text-primary"
                  }
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-foreground">{item.title}</p>
                    <Badge variant="outline">{t(`severity.${item.severity}`)}</Badge>
                  </div>
                  {item.body && (
                    <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">
                      {item.body}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    {new Intl.DateTimeFormat(locale, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(item.createdAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {item.href && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      nativeButton={false}
                      render={
                        <Link href={item.href} aria-label={t("open")}>
                          <ExternalLink className="size-4" aria-hidden />
                        </Link>
                      }
                    />
                  )}
                  {!item.readAt && (
                    <form action={markNotificationRead}>
                      <input type="hidden" name="notificationId" value={item.id} />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("markRead")}
                      >
                        <CheckCheck className="size-4" aria-hidden />
                      </Button>
                    </form>
                  )}
                  <form action={dismissNotification}>
                    <input type="hidden" name="notificationId" value={item.id} />
                    <Button type="submit" variant="ghost" size="icon-sm" aria-label={t("dismiss")}>
                      <X className="size-4" aria-hidden />
                    </Button>
                  </form>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <span className="sr-only">{toLocaleDigits(String(items.length), locale)}</span>
    </PageBody>
  );
}
