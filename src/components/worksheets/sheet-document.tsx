import type { LookupTable } from "@/lib/lookups.ts";
import type { SheetDef } from "@/modules/worksheets/model.ts";
import type { Letterhead, PanelRegister } from "@/modules/worksheets/queries.ts";
import { sectionApplies } from "@/modules/worksheets/values.ts";
import { SheetSectionView, sheetSectionKey } from "./sheet-blocks";
import { type Panel, panelFrom, sheetWords } from "./sheet-words.ts";

/**
 * The printable document.
 *
 * Built from the form's blocks rather than an HTML string, so the house style
 * lives in one stylesheet instead of fourteen templates — and so the sheet on
 * screen is the sheet that prints. A second copy assembled into a hidden frame
 * for the printer is two documents that drift.
 *
 * Every one of these forms is one page of A4. That is a property of the form
 * rather than of this renderer's taste: a defence permit whose fifth section
 * lands on a second sheet is not the permit the office files. So the blocks are
 * laid out at the density the paper uses — paragraphs on a 1.5 line, tables at
 * 0.72em, signatories in small ruled boxes — and the sizes live in one place so
 * all fourteen move together.
 *
 * A server component. Nothing on a printed form is interactive, and rendering
 * it on the server means the browser is sent the finished document rather than
 * fourteen form definitions and a renderer.
 */
export function SheetDocument({
  sheet,
  decision,
  lookups,
  register,
  letterhead,
  translate,
  locale,
}: {
  sheet: SheetDef;
  /** The case, as a bag of columns. Empty when no case has been chosen. */
  decision: Record<string, unknown>;
  lookups: LookupTable;
  register: PanelRegister;
  letterhead: Letterhead;
  translate: (key: string, values?: Record<string, string>) => string;
  locale: string;
}) {
  const panel = panelFrom(register, locale);
  const words = sheetWords({ decision, lookups, translate, letterhead, panel, locale });

  const degree = decision.education_level ? words.display("education_level") : "";

  const chrome = sheet.chrome ?? "form";

  /**
   * The heading the sheet carries, which is not the heading the index carries.
   *
   * The degree goes after it in parentheses on the forms and on nothing else:
   * the notices head themselves «اطلاعیه برگزاری جلسه دفاع …» and name the
   * degree on a line of their own beneath it, and the originality declaration
   * is headed «اصالت‌نامه پایان‌نامه» with no degree at all. A form for a
   * master's and a form for a doctorate are different instruments and the paper
   * says which it is.
   */
  const title = words.fill(sheet.titleKey ?? sheet.labelKey);
  const headTitle =
    chrome === "form" && degree !== "" && degree !== "…"
      ? `${title} (${words.t("sheet.f.degree")} ${degree})`
      : title;

  const visible = sheet.sections.filter((section) => sectionApplies(section.only, decision));

  return (
    <article
      className={`worksheet worksheet-${sheet.id}`}
      dir={locale.toLowerCase().startsWith("fa") ? "rtl" : "ltr"}
      lang={locale}
    >
      <SheetHead
        sheet={sheet}
        chrome={chrome}
        title={headTitle}
        subtitle={sheet.subtitleKey ? words.fill(sheet.subtitleKey) : ""}
        letterhead={letterhead}
        words={words}
      />

      {visible.map((section) => (
        <SheetSectionView
          key={sheetSectionKey(section)}
          section={section}
          words={words}
          panel={panel}
        />
      ))}

      <SheetFoot sheet={sheet} words={words} />
    </article>
  );
}

/**
 * The head of a printed sheet, in the four shapes the paper uses.
 *
 * See `SheetChrome` for why this is not one head with parts switched off: a
 * case file's references across the top of a public poster, or a filing header
 * on the page bound into the thesis, is a visible difference on every sheet
 * before a word of the form itself.
 */
function SheetHead({
  sheet,
  chrome,
  title,
  subtitle,
  letterhead,
  words,
}: {
  sheet: SheetDef;
  chrome: string;
  title: string;
  subtitle: string;
  letterhead: Letterhead;
  words: ReturnType<typeof sheetWords>;
}) {
  if (chrome === "notice") {
    return (
      <header className="ws-head ws-head-notice">
        <h2 className="ws-notice-title">{title}</h2>
        {subtitle !== "" && <p className="ws-notice-subtitle">{subtitle}</p>}
      </header>
    );
  }

  /* The bound minute: the number the thesis is registered under, and nothing
     else. No form name — the sheet is identified by the volume it is bound
     into — and no reference block. */
  if (chrome === "minute") {
    return (
      <header className="ws-head ws-head-minute">
        {letterhead.crest !== "" && (
          // biome-ignore lint/performance/noImgElement: a data URI has no remote origin to optimise and next/image cannot size one
          <img className="ws-head-logo" src={letterhead.crest} alt="" aria-hidden="true" />
        )}
        <p className="ws-head-registration ws-num">
          {words.t("sheet.f.registrationNumber")}: {words.display("thesis_code")}
        </p>
      </header>
    );
  }

  return (
    <header className="ws-head">
      {/*
       * The university's arms, where the paper puts them.
       *
       * Decorative to a reader — the letterhead beside it already names the
       * institution — so no alt text. An `<img>` rather than a background,
       * which is also what makes it print: browsers omit background images from
       * a printed page unless the reader has turned backgrounds on.
       */}
      {letterhead.crest !== "" && (
        // biome-ignore lint/performance/noImgElement: a data URI has no remote origin to optimise and next/image cannot size one
        <img className="ws-head-logo" src={letterhead.crest} alt="" aria-hidden="true" />
      )}
      <div className="ws-head-titles">
        {/* Nothing where the institution has not been named. A sheet with an
            empty letterhead is honest; a sheet asserting it came from an
            institution called «دانشگاه» is not. */}
        {letterhead.named && (
          <>
            <p className="ws-head-org">{letterhead.name}</p>
            {letterhead.faculty !== "" && <p className="ws-head-faculty">{letterhead.faculty}</p>}
          </>
        )}
        <h2 className="ws-head-name">{title}</h2>
      </div>

      {chrome === "form" && (
        <dl className="ws-head-meta ws-num">
          {/*
           * A ruled blank, not the record's key.
           *
           * A decision is stored under a UUID, and a UUID across the head of a
           * signed form is a worse difference than the one it fixes. An
           * unfilled value draws exactly this rule for the office to write the
           * reference on, until the register grows a human-facing number.
           */}
          <div>
            <dt>{words.t("sheet.f.number")}:</dt>
            <dd className="ws-cell-rule" />
          </div>
          <div>
            <dt>{words.t("sheet.f.date")}:</dt>
            <dd>
              {words.display(
                sheet.referenceDate === "defense" ? "defense_meeting_date" : "meeting_date",
              )}
            </dd>
          </div>
          {sheet.registration && (
            <div>
              <dt>{words.t("sheet.f.registrationNumber")}:</dt>
              <dd>{words.display("thesis_code")}</dd>
            </div>
          )}
        </dl>
      )}
    </header>
  );
}

/**
 * Document control.
 *
 * The office will not accept a *form* without its code, so this is part of the
 * form rather than decoration — but the two notices are notices rather than
 * forms and carry neither a code nor a revision, so they get no control block
 * at all instead of one with an invented code in it.
 *
 * `00` in Latin figures beside a Latin form code: the two are one
 * document-control mark and the paper prints both in the same figures.
 */
function SheetFoot({ sheet, words }: { sheet: SheetDef; words: ReturnType<typeof sheetWords> }) {
  if (!sheet.formCode) return null;
  return (
    <footer className="ws-foot">
      <span dir="ltr">
        {words.t("sheet.formCode")}: {sheet.formCode}
      </span>
      {sheet.footnote && <span className="ws-foot-note">{words.t(sheet.footnote)}</span>}
      <span>
        {words.t("sheet.revision")}: <span dir="ltr">00</span>
      </span>
    </footer>
  );
}

export type { Panel };
