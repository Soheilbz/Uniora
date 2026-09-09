import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import QRCode from "qrcode";
import { PrintButton } from "@/components/engine/print-anchor.tsx";
import { Button } from "@/components/ui/button.tsx";
import { isUuid } from "@/lib/uuid.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { readPrintableCertificate } from "@/modules/workshops/queries.ts";

export default async function CertificatePrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await requireCapability("workshops.view");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const certificate = await readPrintableCertificate(viewer.tenantId, id);
  if (!certificate) notFound();
  const [t, common, format] = await Promise.all([
    getTranslations("workshops.certificatePrint"),
    getTranslations("common"),
    getFormatter(),
  ]);
  const origin = (process.env.BETTER_AUTH_URL ?? "http://localhost:3020").replace(/\/+$/g, "");
  const verificationUrl = `${origin}/verify/certificate/${encodeURIComponent(certificate.verificationCode)}`;
  const qr = await QRCode.toDataURL(verificationUrl, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 184,
  });
  return (
    <div className="mx-auto grid min-h-screen max-w-4xl place-items-center bg-muted/30 p-4 print:max-w-none print:bg-white print:p-0">
      <article className="relative w-full overflow-hidden rounded-2xl border bg-background p-8 shadow-sm print:rounded-none print:border-0 print:p-12 print:shadow-none">
        <div data-print-hide className="mb-6 flex justify-end gap-2">
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href="/workshops?tab=certificates">{common("back")}</Link>}
          />
          <PrintButton label={common("print")} />
        </div>
        <header className="border-b pb-6 text-center">
          <p className="text-sm text-muted-foreground">
            {certificate.institutionNameEn || certificate.institutionName || ""}
          </p>
          <h1 className="mt-2 text-3xl font-semibold">{t("title")}</h1>
          {certificate.faculty ? (
            <p className="mt-2 text-sm text-muted-foreground">{certificate.faculty}</p>
          ) : null}
        </header>
        <section className="grid gap-6 py-10 text-center">
          <p className="text-base text-muted-foreground">{t("certify")}</p>
          <p className="text-3xl font-semibold">{certificate.participantName}</p>
          <p className="mx-auto max-w-2xl text-lg">
            {t("completed", { workshop: certificate.workshopTitle })}
          </p>
          {certificate.durationHours ? (
            <p>{t("duration", { hours: Number(certificate.durationHours) })}</p>
          ) : null}
        </section>
        <footer className="grid gap-5 border-t pt-6 md:grid-cols-[1fr_auto] md:items-end">
          <div className="grid gap-2 text-sm">
            <p>
              <span className="text-muted-foreground">{t("number")}: </span>
              <span className="font-mono" dir="ltr">
                {certificate.certificateNumber}
              </span>
            </p>
            <p>
              <span className="text-muted-foreground">{t("issued")}: </span>
              {format.dateTime(new Date(certificate.issueDate), { dateStyle: "long" })}
            </p>
            <p>
              <span className="text-muted-foreground">{t("verification")}: </span>
              <span className="font-mono" dir="ltr">
                {certificate.verificationCode}
              </span>
            </p>
            <p className="break-all text-xs text-muted-foreground" dir="ltr">
              {verificationUrl}
            </p>
          </div>
          <div className="grid justify-items-center gap-1">
            <Image
              className="size-[184px]"
              src={qr}
              alt={t("qrLabel")}
              width={184}
              height={184}
              unoptimized
            />
            <span className="text-xs text-muted-foreground">{t("scan")}</span>
          </div>
        </footer>
      </article>
    </div>
  );
}
