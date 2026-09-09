import { BadgeCheck, CircleX } from "lucide-react";
import type { Metadata } from "next";
import { verifyPublicCertificate } from "@/modules/public/queries.ts";

export const metadata: Metadata = {
  title: "Certificate verification",
  robots: { index: false, follow: false },
};
export default async function CertificateVerificationPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const certificate = await verifyPublicCertificate(code);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl items-center px-4 py-12">
      <section
        className="w-full rounded-2xl border bg-card p-6 shadow-sm sm:p-8"
        aria-live="polite"
      >
        {certificate ? (
          <>
            <div className="mb-6 flex items-center gap-3">
              <BadgeCheck className="size-8 text-emerald-600" aria-hidden />
              <div>
                <h1 className="text-xl font-semibold">Valid certificate</h1>
                <p className="text-sm text-muted-foreground">گواهی معتبر است</p>
              </div>
            </div>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Certificate number / شماره گواهی"
                value={certificate.certificateNumber}
              />
              <Field label="Issue date / تاریخ صدور" value={certificate.issueDate} />
              <Field label="Participant / شرکت‌کننده" value={certificate.participantName} />
              <Field label="Workshop / کارگاه" value={certificate.workshopTitle} />
              {certificate.institutionName && (
                <Field label="Institution / مؤسسه" value={certificate.institutionName} />
              )}
            </dl>
            <p className="mt-6 border-t pt-4 text-xs text-muted-foreground">
              Verification code:{" "}
              <span className="font-mono" dir="ltr">
                {code.toUpperCase()}
              </span>
            </p>
          </>
        ) : (
          <div className="flex items-start gap-3">
            <CircleX className="mt-0.5 size-8 text-destructive" aria-hidden />
            <div>
              <h1 className="text-xl font-semibold">Certificate not verified</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                گواهی با این کد یافت نشد یا دیگر معتبر نیست.
              </p>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium">{value}</dd>
    </div>
  );
}
