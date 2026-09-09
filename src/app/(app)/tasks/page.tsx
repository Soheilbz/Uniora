import { CheckCircle2, Clock3, ListTodo, Plus } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { PageBody } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { can } from "@/lib/capabilities.ts";
import { requireModule } from "@/lib/viewer.ts";
import { createTask, transitionTask } from "@/modules/tasks/actions.ts";
import { readTasks } from "@/modules/tasks/queries.ts";

export async function generateMetadata() {
  const t = await getTranslations("tasks");
  return { title: t("title") };
}

export default async function TasksPage() {
  const { viewer } = await requireModule("/tasks");
  const [t, locale, items] = await Promise.all([
    getTranslations("tasks"),
    getLocale(),
    readTasks(viewer),
  ]);
  const manage = can(viewer, "tasks.manage");
  const open = items.filter(
    (item) => item.status !== "completed" && item.status !== "cancelled",
  ).length;

  return (
    <PageBody className="gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle", { count: open })}</p>
        </div>
        <Badge variant="outline" className="gap-1">
          <ListTodo className="size-3.5" aria-hidden />
          {t("openCount", { count: open })}
        </Badge>
      </div>

      {manage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("newTask")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              action={createTask}
              className="grid gap-3 md:grid-cols-[minmax(0,1fr)_11rem_11rem_auto] md:items-end"
            >
              <label className="grid gap-1 text-sm">
                <span>{t("fields.title")}</span>
                <Input name="title" required maxLength={300} />
              </label>
              <label className="grid gap-1 text-sm">
                <span>{t("fields.priority")}</span>
                <select
                  name="priority"
                  defaultValue="normal"
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
                >
                  <option value="normal">{t("priority.normal")}</option>
                  <option value="high">{t("priority.high")}</option>
                  <option value="critical">{t("priority.critical")}</option>
                  <option value="low">{t("priority.low")}</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span>{t("fields.dueOn")}</span>
                <Input name="dueOn" type="date" />
              </label>
              <Button type="submit">
                <Plus className="size-4" aria-hidden />
                {t("create")}
              </Button>
              <label className="grid gap-1 text-sm md:col-span-4">
                <span>{t("fields.description")}</span>
                <Textarea name="description" maxLength={4000} />
              </label>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-2">
        {items.map((item) => (
          <Card key={item.id} className={item.status === "completed" ? "opacity-70" : undefined}>
            <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{item.title}</p>
                  <Badge variant="outline">{t(`priority.${item.priority}`)}</Badge>
                  <Badge variant="secondary">{t(`status.${item.status}`)}</Badge>
                </div>
                {item.description && (
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {item.description}
                  </p>
                )}
                <p className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span>{t("assignee", { name: item.assigneeName ?? t("unassigned") })}</span>
                  {item.dueAt && (
                    <span className="inline-flex items-center gap-1">
                      <Clock3 className="size-3" aria-hidden />
                      {new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(item.dueAt)}
                    </span>
                  )}
                </p>
              </div>
              {item.status !== "completed" && item.status !== "cancelled" && (
                <form action={transitionTask} className="flex shrink-0 items-center gap-2">
                  <input type="hidden" name="id" value={item.id} />
                  <input type="hidden" name="version" value={item.version} />
                  <select
                    name="status"
                    defaultValue={item.status}
                    className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
                  >
                    <option value="open">{t("status.open")}</option>
                    <option value="in_progress">{t("status.in_progress")}</option>
                    <option value="blocked">{t("status.blocked")}</option>
                    <option value="completed">{t("status.completed")}</option>
                    <option value="cancelled">{t("status.cancelled")}</option>
                  </select>
                  <Button type="submit" variant="outline" size="sm">
                    <CheckCircle2 className="size-4" aria-hidden />
                    {t("update")}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        ))}
        {items.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              {t("empty")}
            </CardContent>
          </Card>
        )}
      </div>
    </PageBody>
  );
}
