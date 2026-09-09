import { FileText, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { AutoPrint } from "@/components/engine/print-anchor";
import { PageBody, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { SheetDocument } from "@/components/worksheets/sheet-document";
import { SheetSearch } from "@/components/worksheets/sheet-search";
import { WorksheetPreview } from "@/components/worksheets/worksheet-preview";
import { toLocaleDigits } from "@/lib/digits.ts";
import { dynamicTranslator } from "@/lib/dynamic-translator.ts";
import { MAX_SEARCH_LENGTH } from "@/lib/input-limits.ts";
import { type LookupTable, lookupTable } from "@/lib/lookups.ts";
import { singleParam } from "@/lib/register/params.ts";
import { cn } from "@/lib/utils";
import { requireModule } from "@/lib/viewer.ts";
import {
  missingFor,
  SHEET_BY_ID,
  sheetFields,
  sheetsFor,
  stageOf,
  stageOfSheet,
} from "@/modules/worksheets/catalogue.ts";
import type { SheetDef } from "@/modules/worksheets/model.ts";
import {
  findCases,
  MAX_CASES,
  readCase,
  readLetterhead,
  readPanelRegister,
  studentOnFile,
} from "@/modules/worksheets/queries.ts";
import { SHEET_LOOKUP_SETS } from "@/modules/worksheets/values.ts";

export async function generateMetadata() {
  const t = await getTranslations("worksheets");
  return { title: t("title") };
}

interface Params {
  q?: string | string[];
  case?: string | string[];
  sheet?: string | string[];
  print?: string | string[];
}

export default async function WorksheetsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { viewer } = await requireModule("/worksheets");
  const params = await searchParams;

  const search = singleParam(params.q).slice(0, MAX_SEARCH_LENGTH);
  const caseId = singleParam(params.case);
  const sheetId = singleParam(params.sheet);
  const printMode = singleParam(params.print) === "1";

  const locale = await getLocale();

  const [t, common, nav] = await Promise.all([
    getTranslations("worksheets"),
    getTranslations("common"),
    getTranslations("nav"),
  ]);

  const message = await getTranslations();
  const translate = dynamicTranslator(message);

  const { cases, overflowing } = await findCases(viewer.tenantId, search);

  const knownStudent =
    search.trim() !== "" && cases.length === 0
      ? await studentOnFile(viewer.tenantId, search)
      : false;

  const chosenCase = cases.some((row) => row.id === caseId)
    ? await readCase(viewer.tenantId, caseId)
    : null;

  const sheet = SHEET_BY_ID.get(sheetId) ?? null;

  const otherStage =
    sheet !== null &&
    chosenCase !== null &&
    stageOf(chosenCase.report_category) !== undefined &&
    stageOfSheet(sheet) !== stageOf(chosenCase.report_category);

  const offered = chosenCase ? sheetsFor(chosenCase.report_category) : [];

  const [lookups, letterhead] = await Promise.all([
    lookupTable(viewer.tenantId, SHEET_LOOKUP_SETS),
    readLetterhead(viewer.tenantId),
  ]);

  const register =
    sheet && chosenCase
      ? await readPanelRegister(viewer.tenantId, namesOn(sheet, chosenCase))
      : new Map();

  const missing = sheet && chosenCase ? missingFor(sheet, chosenCase) : [];

  /* Printing remains available while a letterhead is incomplete. The document
   * renderer already omits missing optional crest/faculty values, and blocking
   * the route here accidentally sent users back to the interactive preview,
   * which is not a printable A4 document at all. */
  if (printMode && sheet && chosenCase && !otherStage) {
    return (
      <div className="worksheet-print-route">
        <AutoPrint />
        <SheetDocument
          sheet={sheet}
          decision={chosenCase}
          lookups={lookups}
          register={register}
          letterhead={letterhead}
          translate={translate}
          locale={locale}
        />
      </div>
    );
  }

  const groups = groupByCategory(offered.length > 0 ? offered : []);

  const href = (next: { case?: string; sheet?: string }) => {
    const query = new URLSearchParams();
    if (search) query.set("q", search);
    const nextCase = next.case ?? caseId;
    if (nextCase) query.set("case", nextCase);
    const nextSheet = next.sheet ?? (next.case ? "" : sheetId);
    if (nextSheet) query.set("sheet", nextSheet);
    return `/worksheets?${query.toString()}`;
  };

  const resolveFieldLabel = (field: string): string => {
    const camel = field.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
    const key = `decisions.field.${camel}`;
    try {
      const res = translate(key);
      if (res && res !== key) return res;
    } catch {
      // fallback
    }
    return field;
  };

  return (
    <PageBody className="worksheet-page">
      <div data-print-hide>
        <PageHeader
          title={t("title")}
          breadcrumbLabel={nav("breadcrumb")}
          breadcrumbs={[{ label: t("title") }]}
        />
      </div>

      {/* 3-Column Layout: columns 1 & 2 hidden on print, column 3 (document) visible */}
      <div className="worksheet-workspace grid min-h-0 flex-1 grid-cols-1 items-start gap-4 overflow-hidden lg:grid-cols-[14rem_14rem_1fr] xl:grid-cols-[16rem_16rem_1fr]">
        {/* Column 1: Search and Cases */}
        <div data-print-hide className="flex flex-col">
          <Card className="worksheet-panel flex min-h-0 flex-col rounded-xl border border-border/80 bg-card/95 shadow-2xs backdrop-blur-xs">
            <CardHeader className="border-b border-border/40 bg-muted/20 px-4 py-3 shrink-0">
              <CardTitle className="text-sm font-semibold text-foreground">{t("pick")}</CardTitle>
              <CardDescription className="text-xs">{t("pickHint")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2.5 p-4 flex-1 overflow-y-auto min-h-0">
              <SheetSearch
                value={search}
                placeholder={t("searchPlaceholder")}
                label={common("search")}
              />

              {search.trim() === "" && (
                <p className="text-xs text-muted-foreground py-2 text-center">
                  {t("searchPrompt")}
                </p>
              )}

              {search.trim() !== "" && cases.length === 0 && (
                <p className="text-xs text-muted-foreground py-2 text-center">
                  {knownStudent ? t("studentNoCases") : t("noMatch")}
                </p>
              )}

              {cases.length > 0 && (
                <ul
                  aria-label={t("caseGroup")}
                  className="flex flex-col gap-2 flex-1 overflow-y-auto pr-1"
                >
                  {cases.map((row) => {
                    const chosen = row.id === caseId;
                    return (
                      <li key={row.id}>
                        <Link
                          href={href({ case: row.id })}
                          aria-current={chosen ? "true" : undefined}
                          className={cn(
                            "flex flex-col items-start gap-1 rounded-lg border p-2.5 text-start text-xs transition-all",
                            chosen
                              ? "border-primary/50 bg-primary/10 shadow-2xs ring-1 ring-primary/20"
                              : "border-border/70 bg-card/60 hover:border-border hover:bg-muted/30",
                          )}
                        >
                          <div className="flex w-full items-center justify-between gap-2">
                            <span className="font-semibold text-foreground">
                              {row.studentName ?? "—"}
                            </span>
                            <Badge
                              variant={chosen ? "default" : "outline"}
                              className="font-medium text-[10px] shadow-2xs"
                            >
                              {categoryLabel(lookups, row.reportCategory)}
                            </Badge>
                          </div>
                          <span
                            title={row.thesisTitle ?? ""}
                            className="line-clamp-2 text-xs text-muted-foreground leading-relaxed"
                          >
                            {row.thesisTitle || t("untitled")}
                          </span>
                          <span className="numeric text-[11px] text-muted-foreground/70">
                            {t("meetingLine", {
                              number:
                                row.meetingNumber === null
                                  ? "—"
                                  : toLocaleDigits(row.meetingNumber, locale),
                            })}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}

              {overflowing && (
                <p className="text-[11px] text-muted-foreground text-center mt-auto">
                  {t("tooMany", { count: toLocaleDigits(String(MAX_CASES), locale) })}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Column 2: Worksheet Type Selector */}
        <div data-print-hide className="flex flex-col">
          <Card className="worksheet-panel flex min-h-0 flex-col rounded-xl border border-border/80 bg-card/95 shadow-2xs backdrop-blur-xs">
            <CardHeader className="border-b border-border/40 bg-muted/20 px-4 py-3 shrink-0">
              <CardTitle className="text-sm font-semibold text-foreground">{t("type")}</CardTitle>
              <CardDescription className="text-xs">
                {chosenCase
                  ? `${chosenCase.student_name ?? "—"} (${categoryLabel(lookups, typeof chosenCase.report_category === "string" ? chosenCase.report_category : null)})`
                  : t("typeHint")}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 p-4 flex-1 overflow-y-auto min-h-0">
              {!chosenCase ? (
                <div className="flex flex-col items-center justify-center py-16 text-center text-xs text-muted-foreground">
                  <FileText className="size-10 opacity-30 mb-2" />
                  <p>{t("pickCaseHint")}</p>
                </div>
              ) : (
                groups.map((group) => (
                  <SheetGroup
                    key={group.category}
                    label={categoryLabel(lookups, group.category)}
                    sheets={group.sheets}
                    chosen={sheetId}
                    hrefFor={(id) => href({ sheet: id })}
                    translate={translate}
                  />
                ))
              )}
            </CardContent>
          </Card>
        </div>

        {/* Column 3: Document Sheet Preview and Action Bar */}
        <div className="worksheet-preview-column flex min-h-0 min-w-0 flex-col gap-3 overflow-hidden">
          {sheet && chosenCase && (
            <div
              data-print-hide
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-card/60 p-3 shadow-2xs backdrop-blur-xs"
            >
              <div className="flex items-center gap-2">
                {!otherStage && letterhead.readyForOfficialPrint && (
                  <Button
                    variant="outline"
                    nativeButton={false}
                    render={
                      <Link href={`${href({})}&print=1`} target="_blank" rel="noreferrer">
                        <FileText className="size-4" aria-hidden />
                        {t("print")}
                      </Link>
                    }
                  />
                )}
                <p className="text-xs leading-relaxed text-muted-foreground">{t("printHint")}</p>
              </div>
              {missing.length > 0 && (
                <Badge variant="outline" className="text-warning border-warning/40 text-xs">
                  {t("missing", { count: toLocaleDigits(String(missing.length), locale) })}
                </Badge>
              )}
            </div>
          )}

          {sheet && chosenCase ? (
            <>
              {otherStage && <Warning>{t("otherStageWarning")}</Warning>}
              {!letterhead.readyForOfficialPrint && <Warning>{t("institutionUnnamed")}</Warning>}
              {missing.length > 0 ? (
                <Warning>
                  {t("missing", { count: toLocaleDigits(String(missing.length), locale) })}{" "}
                  {missing
                    .map((field) => resolveFieldLabel(field))
                    .join(locale.toLowerCase().startsWith("fa") ? "، " : ", ")}
                </Warning>
              ) : (
                <p data-print-hide className="text-xs text-muted-foreground">
                  {t("missingNone")}
                </p>
              )}

              <WorksheetPreview>
                <SheetDocument
                  sheet={sheet}
                  decision={chosenCase}
                  lookups={lookups}
                  register={register}
                  letterhead={letterhead}
                  translate={translate}
                  locale={locale}
                />
              </WorksheetPreview>
            </>
          ) : (
            <div data-print-hide>
              <Empty className="worksheet-empty flex min-h-0 flex-col justify-center border border-dashed py-20">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FileText aria-hidden />
                  </EmptyMedia>
                  <EmptyTitle>{chosenCase ? t("chooseSheet") : t("chooseCase")}</EmptyTitle>
                  <EmptyDescription>{t("emptyHint")}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            </div>
          )}
        </div>
      </div>
    </PageBody>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-print-hide
      className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3.5 text-xs text-warning-foreground shadow-2xs backdrop-blur-xs"
    >
      <TriangleAlert className="size-4 shrink-0 text-warning mt-0.5" />
      <div className="flex-1 leading-relaxed">{children}</div>
    </div>
  );
}

function SheetGroup({
  label,
  sheets,
  chosen,
  hrefFor,
  translate,
}: {
  label: string;
  sheets: SheetDef[];
  chosen: string | undefined;
  hrefFor: (id: string) => string;
  translate: (key: string, values?: Record<string, string>) => string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-xs font-semibold text-muted-foreground">{label}</h3>
      <ul className="flex flex-col gap-1">
        {sheets.map((sheet) => {
          const isSelected = sheet.id === chosen;
          return (
            <li key={sheet.id}>
              <Link
                href={hrefFor(sheet.id)}
                className={cn(
                  "flex items-center justify-between rounded-lg px-3 py-2 text-xs font-medium transition-all",
                  isSelected
                    ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                    : "bg-muted/40 text-foreground hover:bg-muted/80",
                )}
              >
                <span>{translate(sheet.labelKey)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function groupByCategory(sheets: readonly SheetDef[]): { category: string; sheets: SheetDef[] }[] {
  const map = new Map<string, SheetDef[]>();
  for (const sheet of sheets) {
    const category = sheet.category ?? "general";
    const existing = map.get(category) ?? [];
    existing.push(sheet);
    map.set(category, existing);
  }
  return [...map.entries()].map(([category, s]) => ({ category, sheets: s }));
}

function categoryLabel(lookups: LookupTable, category: string | null | undefined): string {
  if (!category) return "—";
  const entry = lookups.get("worksheet_categories")?.find((e) => e.value === category);
  return entry?.label ?? category;
}

function namesOn(sheet: SheetDef, _decision: Record<string, unknown>): string[] {
  return sheetFields(sheet);
}
