import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { AutoPrint, PrintButton } from "@/components/engine/print-anchor";
import { Button } from "@/components/ui/button";
import { readInstitution } from "@/modules/settings/institution-queries.ts";

/**
 * The frame around anything this application prints for the file.
 *
 * A printed page leaves the building: it is filed, signed and posted, so it
 * carries the institution's name, what it is a list of, and when it was taken —
 * without which a printout on a desk six months later means nothing. The
 * on-screen controls are the only part marked `data-print-hide`; everything else
 * is the document.
 *
 * A server component, and that is the whole reason these are simpler here than
 * in the application. There, the frame had to know whether its rows had
 * arrived — a print dialog opened over a half-loaded table prints half a list,
 * and a *failed* query settles into an empty table that reads as a complete and
 * empty register. Here the page is rendered on the server with its rows already
 * in it: there is no half-loaded state to guard against, and a failed read
 * throws before any of this reaches the browser.
 */

export async function PrintDocument({
  tenantId,
  title,
  subject,
  backTo,
  backLabel,
  children,
}: {
  tenantId: string;
  title: string;
  /** Sub-heading naming exactly what was printed — which list, which filter. */
  subject?: string;
  backTo: string;
  backLabel: string;
  children: React.ReactNode;
}) {
  const [institution, t, print, format] = await Promise.all([
    readInstitution(tenantId),
    getTranslations("common"),
    getTranslations("print"),
    getFormatter(),
  ]);

  return (
    <div className="mx-auto max-w-4xl p-8 print:max-w-none print:p-0">
      {/*
       * Opened for the reader, because that is what they came for: the link
       * that reaches this page is «چاپ», and a page that arrives without a
       * dialog has put a step back in front of the thing that was asked for.
       * The controls stay, so it can be printed again or backed out of.
       */}
      <AutoPrint />

      <div data-print-hide className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href={backTo}>{backLabel}</Link>}
        />
        <PrintButton label={t("print")} />
      </div>

      <header className="mb-6 border-b pb-4">
        {institution.name && (
          <p className="text-sm font-medium">
            {institution.name}
            {institution.faculty ? ` — ${institution.faculty}` : ""}
          </p>
        )}
        <h1 className="mt-1 text-xl font-semibold">{title}</h1>
        {subject && <p className="mt-0.5 text-sm text-muted-foreground">{subject}</p>}
        {/*
         * When it was taken. A printed register with no date on it cannot be
         * placed against the state of the system it describes, which is the one
         * question anybody asks of a printout months later.
         */}
        <p className="mt-2 text-xs text-muted-foreground numeric">
          {print("generatedAt")}{" "}
          {format.dateTime(new Date(), { dateStyle: "long", timeStyle: "short" })}
        </p>
      </header>

      {children}
    </div>
  );
}

/**
 * A plain table for printed output.
 *
 * Borders on every cell, because a printed list is read across a row with a
 * finger rather than with a hover highlight.
 */
export function PrintTable({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr>
          {head.map((cell) => (
            <th
              scope="col"
              key={cell}
              className="border bg-accent px-3 py-2 text-start font-medium print:bg-transparent"
            >
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

export function PrintCell({ children, ltr }: { children: React.ReactNode; ltr?: boolean }) {
  return (
    <td className="border px-3 py-1.5 align-top" {...(ltr ? { dir: "ltr" } : {})}>
      {children}
    </td>
  );
}
