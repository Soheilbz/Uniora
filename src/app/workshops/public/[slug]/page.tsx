import { CalendarDays, CheckCircle2, Clock3, MapPin } from "lucide-react";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { readPublicWorkshop } from "@/modules/public/queries.ts";
import { registerPublicWorkshop } from "./actions.ts";
export default async function PublicWorkshopPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ registered?: string; error?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const workshop = await readPublicWorkshop(slug);
  if (!workshop) notFound();
  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl px-4 py-10">
      <article className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
        <p className="text-sm text-muted-foreground">
          {workshop.institutionName ?? "University workshop"}
        </p>
        <h1 className="mt-1 text-2xl font-semibold">{workshop.title}</h1>
        {workshop.description && (
          <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">
            {workshop.description}
          </p>
        )}
        <div className="mt-5 grid gap-2 text-sm sm:grid-cols-3">
          {workshop.workshopDate && <Meta icon={<CalendarDays />}>{workshop.workshopDate}</Meta>}
          {workshop.durationHours && <Meta icon={<Clock3 />}>{workshop.durationHours} h</Meta>}
          {workshop.venue && <Meta icon={<MapPin />}>{workshop.venue}</Meta>}
        </div>
        {query.registered === "1" ? (
          <div className="mt-8 rounded-xl border bg-muted/30 p-4">
            <div className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="size-5 text-emerald-600" />
              Registration received
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              درخواست ثبت‌نام دریافت شد و پس از بررسی در سامانه ثبت نهایی می‌شود.
            </p>
          </div>
        ) : workshop.registrationOpen ? (
          <form
            action={registerPublicWorkshop}
            className="mt-8 grid gap-4 rounded-xl border p-4 sm:grid-cols-2"
          >
            <input type="hidden" name="slug" value={slug} />
            <h2 className="sm:col-span-2 text-base font-semibold">Registration / ثبت‌نام</h2>
            {query.error && (
              <p className="sm:col-span-2 text-sm text-destructive">
                Registration could not be accepted. Please review the details or try later.
              </p>
            )}
            <label className="grid gap-1.5 text-sm">
              Full name / نام و نام خانوادگی
              <Input name="fullName" required maxLength={200} />
            </label>
            <label className="grid gap-1.5 text-sm">
              Email
              <Input name="email" type="email" maxLength={254} />
            </label>
            <label className="grid gap-1.5 text-sm">
              Phone / تلفن
              <Input name="phone" inputMode="tel" maxLength={40} />
            </label>
            <label className="grid gap-1.5 text-sm">
              Reference / شناسه اختیاری
              <Input name="reference" maxLength={120} />
            </label>
            <label className="sm:col-span-2 flex items-start gap-2 text-xs text-muted-foreground">
              <input className="mt-0.5" type="checkbox" name="consent" required />I consent to this
              information being used for workshop registration.
            </label>
            <div className="sm:col-span-2">
              <Button type="submit">Submit registration</Button>
            </div>
          </form>
        ) : (
          <p className="mt-8 rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
            Public registration is closed.
          </p>
        )}
      </article>
    </main>
  );
}
function Meta({ icon, children }: { icon: React.ReactElement; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <span className="[&>svg]:size-4" aria-hidden>
        {icon}
      </span>
      <span>{children}</span>
    </div>
  );
}
