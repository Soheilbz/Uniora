/**
 * «دستورالعمل تعیین ظرفیت راهنمایی پارسا (پایان‌نامه و رساله)» as data.
 *
 * Revision 00, approved at the thirty-fourth presidency sitting of 1403/12/05,
 * with 16 articles and 11 provisos. Its own header numbers the revision, so
 * there will be a revision 01 — and the whole point of this file is that
 * revision 01 is an edit to a table rather than a rewrite of a function.
 *
 * Nothing below is a branch. The base capacities, the modifiers, the fractional
 * weights and the exclusions are all *values*, and every one of them carries
 * the article or proviso it comes from, so a registrar can lay this beside the
 * PDF and check it line by line.
 *
 * ── This file knows nothing about the database ──────────────────────────────
 *
 * It states the university's rules. `ledger.ts` decides which supervisions
 * occupy a place and `engine.ts` applies these figures to them; both of those
 * know about columns, and this one does not. The separation is deliberate: the
 * regulation is the university's, the columns are ours, and the mapping between
 * them is the part that will turn out to be wrong.
 */

/** Which published revision the figures below are transcribed from. */
export const CAPACITY_REGULATION = {
  revision: "00",
  approvedAt: "1403/12/05",
  sitting: "سی‌وچهارمین جلسه‌ی هیأت رییسه",
  articles: 16,
  provisos: 11,
} as const;

/**
 * The two tables, and the two of them only.
 *
 * Table 1 is «ظرفیت راهنمایی رساله‌ی دکتری» — the doctoral dissertation. Table 2
 * is «ظرفیت راهنمایی پایان‌نامه‌ی کارشناسی‌ارشد و دکتری عمومی» — the master's
 * thesis *and* the professional doctorate. The professional doctorate writes a
 * پایان‌نامه, not a رساله, which article 2.1 states outright when it defines
 * پارسا as the three of them together.
 */
export type CapacityTable = "dissertation" | "thesis";

/**
 * The three ranks the tables have a column for.
 *
 * «مربی» is deliberately absent, and that is the regulation's doing rather than
 * an omission here: the tables have three columns. An instructor therefore has
 * no allowance to compute, which the engine reports as «no base» rather than as
 * zero — those are different answers, and only one of them is true.
 */
export type AcademicRank = "full_professor" | "associate_professor" | "assistant_professor";

export const ACADEMIC_RANKS: readonly AcademicRank[] = [
  "full_professor",
  "associate_professor",
  "assistant_professor",
];

export interface CapacityTableRules {
  /** The table's own printed title. */
  title: string;
  citation: string;
  /** Row 1 — «تعداد ظرفیت راهنمایی», by rank. */
  base: Readonly<Record<AcademicRank, number>>;
  /**
   * Row 6 — «تعداد ظرفیت راهنمایی بین‌الملل».
   *
   * Flat across all three ranks in both tables, which is easy to miss in
   * extracted text and plain in the rendered table: 3/3/3 for the dissertation,
   * 4/4/4 for the thesis. It does not step down by rank the way row 1 does.
   */
  international: Readonly<Record<AcademicRank, number>>;
}

export const CAPACITY_TABLES: Readonly<Record<CapacityTable, CapacityTableRules>> = {
  dissertation: {
    title: "ظرفیت راهنمایی رساله‌ی دکتری",
    citation: "جدول ۱",
    base: { full_professor: 5, associate_professor: 4, assistant_professor: 3 },
    international: { full_professor: 3, associate_professor: 3, assistant_professor: 3 },
  },
  thesis: {
    title: "ظرفیت راهنمایی پایان‌نامه‌ی کارشناسی‌ارشد و دکتری عمومی",
    citation: "جدول ۲",
    base: { full_professor: 6, associate_professor: 5, assistant_professor: 4 },
    international: { full_professor: 4, associate_professor: 4, assistant_professor: 4 },
  },
};

/**
 * Which table a degree is counted against.
 *
 * `professional_doctorate` is the entry that matters. Charging it against the
 * dissertation table scores «دکتری حرفه‌ای» against a base of 5/4/3 instead of
 * 6/5/4 — and it is the largest cohort this faculty supervises, so the error
 * would be both invisible and systematic.
 *
 * `specialty` — دستیاری تخصصی — is not named anywhere in the regulation.
 * Article 2.1 lists three kinds of پارسا and the residency is not one of them,
 * but article 3 extends capacity to «کلیه‌ی دوره‌ها و مقاطع تحصیلات تکمیلی», so
 * it has to be counted somewhere and falling through is not an option. It is
 * assigned to the thesis table: a residency produces a پایان‌نامه rather than a
 * رساله, and table 2 already carries the other professional qualification.
 * A decision made ahead of the enrolment rather than one measured against a
 * register — recorded here so it can be revisited rather than rediscovered.
 *
 * `bachelor` and `associate` are absent on purpose. Article 3 reaches
 * postgraduate study, and an undergraduate has no supervisor in this sense; a
 * degree with no table is not counted at all, and the ledger says how many it
 * left out.
 */
export const CAPACITY_TABLE_BY_DEGREE: Readonly<Record<string, CapacityTable>> = {
  phd: "dissertation",
  master: "thesis",
  professional_doctorate: "thesis",
  specialty: "thesis",
};

export type CapacityInputAvailability = "recorded" | "derivable" | "absent";

export type CapacityInputId =
  | "academic_rank"
  | "degree"
  | "admission_route"
  | "nationality"
  | "group_membership"
  | "research_score_quartile"
  | "supervision_evaluation_band"
  | "employment_track"
  | "affiliated_member"
  | "tier_one_institutions"
  | "external_funding_multiple"
  | "family_support_status"
  | "secondment_kind"
  | "retirement_date"
  | "appointment_order_date";

/**
 * Rows 2–5: the ±1 adjustments.
 *
 * All four apply to row 1 and to row 1 only. The tables place rows 2–5 between
 * rows 1 and 6 without saying which they attach to — and article 12, which
 * names «ردیف ۱ و ۶» explicitly when it wants both, is the evidence that the
 * unqualified rows mean row 1 alone.
 */
export interface CapacityModifier {
  id: string;
  citation: string;
  label: string;
  delta: number;
  /** The input that decides whether it applies. */
  input: CapacityInputId;
  /** The value of that input which triggers it. */
  when: string;
}

export const CAPACITY_MODIFIERS: readonly CapacityModifier[] = [
  {
    id: "research_score_high",
    citation: "ردیف ۲ جداول ۱ و ۲",
    label: "امتیاز پژوهه‌ی بالا (۲۵ درصد بالای گروه)",
    delta: +1,
    input: "research_score_quartile",
    when: "top",
  },
  {
    id: "supervision_evaluation_high",
    citation: "ردیف ۳ جداول ۱ و ۲",
    label: "ارزشیابی راهنمایی پارسا بالا (رده‌بندی H یا Q1)",
    delta: +1,
    input: "supervision_evaluation_band",
    when: "high",
  },
  {
    id: "research_score_low",
    citation: "ردیف ۴ جداول ۱ و ۲",
    label: "امتیاز پژوهه‌ی پایین (۲۵ درصد پایین گروه)",
    delta: -1,
    input: "research_score_quartile",
    when: "bottom",
  },
  {
    id: "supervision_evaluation_low",
    citation: "ردیف ۵ جداول ۱ و ۲",
    label: "ارزشیابی راهنمایی پارسا پایین (رده‌بندی L یا Q4)",
    delta: -1,
    input: "supervision_evaluation_band",
    when: "low",
  },
];

/** Article 12 — a research-track member gets one more on rows 1 *and* 6. */
export const RESEARCH_TRACK_BONUS = {
  citation: "ماده‌ی ۱۲",
  label: "عضو هیأت‌علمی پژوهشی",
  delta: +1,
  input: "employment_track" as CapacityInputId,
  when: "research",
  /** Unlike the modifiers above, this one does reach the international row. */
  appliesToInternational: true,
} as const;

/**
 * The fractional weights, provisos 7 and 8.
 *
 * Both are «به میزان ۱⁄۲ (نصف)», and proviso 8 states their composition
 * outright: a jointly supervised student from another group is ¼ to each of the
 * two supervisors — which is the two halves multiplied, not added.
 */
export const CAPACITY_WEIGHTS = {
  jointSupervision: {
    citation: "تبصره‌ی ۷",
    label: "راهنمایی مشترک",
    factor: 1 / 2,
  },
  interdisciplinary: {
    citation: "تبصره‌ی ۸",
    label: "راهنمایی دانشجوی سایر گروه‌ها",
    factor: 1 / 2,
  },
  /**
   * Proviso 7's second sentence. Where the second supervisor is from outside
   * the university — and *not* from a reputable foreign university or a
   * domestic tier-1 one — the first supervisor is charged in full rather than
   * halved.
   *
   * The exception to the exception is the problem: nothing records which
   * outside institutions are reputable or tier-1, so this cannot be settled
   * from the register alone.
   */
  externalSecondSupervisor: {
    citation: "تبصره‌ی ۷ (جمله‌ی دوم)",
    label: "استاد راهنمای دوم خارج از دانشگاه",
    firstSupervisorFactor: 1,
  },
} as const;

/**
 * Provisos 1–4: pairings not counted against capacity at all.
 *
 * Every one of them turns on something no column here records, except proviso
 * 3, which turns on the admission route and does. They are listed in full
 * regardless: an exclusion that cannot be evaluated has to be *visible as
 * unevaluated*, because silently not excluding is the permissive direction and
 * silently excluding is worse.
 */
export interface CapacityExclusion {
  id: string;
  citation: string;
  label: string;
  input: CapacityInputId;
}

export const CAPACITY_EXCLUSIONS: readonly CapacityExclusion[] = [
  {
    id: "tier_one_host",
    citation: "تبصره‌ی ۱",
    label: "دانشجوی دانشگاه‌های سطح یک کشور با مجوز و تأمین هزینه از دانشگاه مبدأ",
    input: "tier_one_institutions",
  },
  {
    id: "externally_funded",
    citation: "تبصره‌ی ۲",
    label: "پارسای برون‌دانشگاهی با تأمین اعتبار حداقلی",
    input: "external_funding_multiple",
  },
  {
    id: "supervisor_led_admission",
    citation: "تبصره‌ی ۳",
    label: "پذیرش به شیوه‌ی استادمحوری",
    input: "admission_route",
  },
  {
    id: "family_support_law",
    citation: "تبصره‌ی ۴",
    label: "دانشجوی مادر باردار یا دارای فرزند شیرخوار (قانون حمایت از خانواده)",
    input: "family_support_status",
  },
];

/** Article 13 — simultaneous students may not exceed half the Iranian capacity. */
export const CONCURRENT_CEILING = {
  citation: "ماده‌ی ۱۳",
  label: "سقف دانشجویان همزمان (شامل استادمحوری و برون‌دانشگاهی)",
  factor: 0.5,
  /** Family-support admissions sit above the ceiling rather than under it. */
  exemptExclusion: "family_support_law",
} as const;

/**
 * Every input the regulation asks for, and whether this product can answer it.
 *
 * `recorded` means a column holds it. `derivable` means it can be worked out
 * from columns that do exist, with the caveat named. `absent` means nothing in
 * the database answers it and nothing should pretend to — a capacity that is
 * wrong in the permissive direction lets a group over-assign students, which is
 * the failure this regulation exists to prevent.
 *
 * `supply` says how the office would provide an absent input. It is written for
 * the registrar who has to decide, not for whoever maintains this.
 */
export interface CapacityInput {
  id: CapacityInputId;
  label: string;
  citation: string;
  availability: CapacityInputAvailability;
  /** Where it is read from, or what the office must do to supply it. */
  supply: string;
}

export const CAPACITY_INPUTS: readonly CapacityInput[] = [
  {
    id: "academic_rank",
    label: "مرتبه‌ی علمی",
    citation: "ماده‌ی ۴، ردیف ۱ جداول",
    availability: "recorded",
    supply: "از پرونده‌ی استاد خوانده می‌شود.",
  },
  {
    id: "degree",
    label: "مقطع تحصیلی دانشجو",
    citation: "ماده‌ی ۲.۱",
    availability: "recorded",
    supply: "از پرونده‌ی دانشجو خوانده می‌شود.",
  },
  {
    id: "admission_route",
    label: "شیوه‌ی پذیرش",
    citation: "تبصره‌ی ۳",
    availability: "recorded",
    supply: "از پرونده‌ی دانشجو خوانده می‌شود.",
  },
  {
    id: "nationality",
    label: "تابعیت دانشجو",
    citation: "ردیف ۶ جداول",
    availability: "recorded",
    supply: "از پرونده‌ی دانشجو خوانده می‌شود.",
  },
  {
    id: "group_membership",
    label: "عضویت در گروه آموزشی",
    citation: "تبصره‌ی ۸",
    availability: "derivable",
    supply:
      "از «گروه آموزشی» دانشجو و استاد سنجیده می‌شود؛ جایی که یکی از دو مقدار ثبت نشده باشد، تخفیف اعمال نمی‌شود.",
  },
  {
    id: "research_score_quartile",
    label: "چارک امتیاز پژوهه در گروه",
    citation: "ردیف‌های ۲ و ۴ جداول",
    availability: "absent",
    supply: "فهرست چارک‌بندی امتیاز پژوهه‌ی هر گروه، سالانه از معاونت پژوهشی.",
  },
  {
    id: "supervision_evaluation_band",
    label: "رده‌ی ارزشیابی راهنمایی پارسا",
    citation: "ردیف‌های ۳ و ۵ جداول",
    availability: "absent",
    supply: "نتیجه‌ی ارزشیابی راهنمایی (H/Q1 تا L/Q4) برای هر عضو هیأت علمی.",
  },
  {
    id: "employment_track",
    label: "نوع هیأت علمی (آموزشی یا پژوهشی)",
    citation: "ماده‌ی ۱۲",
    availability: "absent",
    supply: "تفکیک اعضای هیأت علمی پژوهشی از آموزشی، از کارگزینی.",
  },
  {
    id: "affiliated_member",
    label: "عضو هیأت علمی وابسته‌ی گروه",
    citation: "تبصره‌ی ۸",
    availability: "absent",
    supply: "فهرست اعضای وابسته‌ی هر گروه آموزشی.",
  },
  {
    id: "tier_one_institutions",
    label: "دانشگاه‌های سطح یک و دانشگاه‌های معتبر خارجی",
    citation: "تبصره‌های ۱ و ۷",
    availability: "absent",
    supply: "فهرست مصوب دانشگاه‌های سطح یک کشور و دانشگاه‌های معتبر خارجی.",
  },
  {
    id: "external_funding_multiple",
    label: "ضریب اعتبار پارسای برون‌دانشگاهی",
    citation: "تبصره‌ی ۲",
    availability: "absent",
    supply: "مبلغ اعتبار تأمین‌شده برای هر پارسای برون‌دانشگاهی.",
  },
  {
    id: "family_support_status",
    label: "وضعیت مشمول قانون حمایت از خانواده",
    citation: "تبصره‌ی ۴",
    availability: "absent",
    supply: "اعلام دانشجویان مشمول (بارداری یا فرزند شیرخوار) از اداره‌ی آموزش.",
  },
  {
    id: "secondment_kind",
    label: "نوع مأموریت",
    citation: "تبصره‌های ۹ و ۱۰",
    availability: "absent",
    supply: "نوع و بازه‌ی مأموریت اعضای هیأت علمی، از کارگزینی.",
  },
  {
    id: "retirement_date",
    label: "تاریخ بازنشستگی",
    citation: "ماده‌ی ۱۴",
    availability: "absent",
    supply: "تاریخ بازنشستگی هر عضو هیأت علمی، از کارگزینی.",
  },
  {
    id: "appointment_order_date",
    label: "تاریخ حکم کارگزینی",
    citation: "ماده‌ی ۱۵",
    availability: "absent",
    supply: "تاریخ آخرین حکم کارگزینی هر عضو هیأت علمی.",
  },
];

const INPUT_BY_ID = new Map(CAPACITY_INPUTS.map((input) => [input.id, input]));

export function capacityInput(id: CapacityInputId): CapacityInput {
  const found = INPUT_BY_ID.get(id);
  if (!found) throw new Error(`unknown capacity input: ${id}`);
  return found;
}

/** Everything the regulation asks for that nothing in this product answers. */
export const ABSENT_CAPACITY_INPUTS: readonly CapacityInput[] = CAPACITY_INPUTS.filter(
  (input) => input.availability === "absent",
);

export function baseCapacity(table: CapacityTable, rank: AcademicRank): number {
  return CAPACITY_TABLES[table].base[rank];
}

export function internationalCapacity(table: CapacityTable, rank: AcademicRank): number {
  return CAPACITY_TABLES[table].international[rank];
}

export function isAcademicRank(value: unknown): value is AcademicRank {
  return typeof value === "string" && (ACADEMIC_RANKS as readonly string[]).includes(value);
}

export function capacityTableForDegree(degree: unknown): CapacityTable | null {
  if (typeof degree !== "string") return null;
  return CAPACITY_TABLE_BY_DEGREE[degree] ?? null;
}

/**
 * Serializable, versioned representation of the capacity regulation.
 *
 * Revision 00 remains the bootstrap/default, but runtime consumers may resolve
 * an immutable published version from `regulation_versions` and pass it to the
 * engine. Keeping the shape explicit prevents a free-form JSON document from
 * becoming executable policy.
 */
export interface CapacityRuleSet {
  metadata: {
    revision: string;
    approvedAt: string;
    sitting: string;
    articles: number;
    provisos: number;
  };
  tables: Readonly<Record<CapacityTable, CapacityTableRules>>;
  tableByDegree: Readonly<Record<string, CapacityTable>>;
  modifiers: readonly CapacityModifier[];
  researchTrackBonus: typeof RESEARCH_TRACK_BONUS;
  weights: typeof CAPACITY_WEIGHTS;
  exclusions: readonly CapacityExclusion[];
  concurrentCeiling: typeof CONCURRENT_CEILING;
  inputs: readonly CapacityInput[];
}

export const DEFAULT_CAPACITY_RULESET: CapacityRuleSet = {
  metadata: CAPACITY_REGULATION,
  tables: CAPACITY_TABLES,
  tableByDegree: CAPACITY_TABLE_BY_DEGREE,
  modifiers: CAPACITY_MODIFIERS,
  researchTrackBonus: RESEARCH_TRACK_BONUS,
  weights: CAPACITY_WEIGHTS,
  exclusions: CAPACITY_EXCLUSIONS,
  concurrentCeiling: CONCURRENT_CEILING,
  inputs: CAPACITY_INPUTS,
};

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`invalid ${label}`);
  return value;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`invalid ${label}`);
  return value.trim();
}

function parseRankMap(value: unknown, label: string): Record<AcademicRank, number> {
  if (!value || typeof value !== "object") throw new Error(`invalid ${label}`);
  const row = value as Record<string, unknown>;
  return {
    full_professor: finiteNumber(row.full_professor, `${label}.full_professor`),
    associate_professor: finiteNumber(row.associate_professor, `${label}.associate_professor`),
    assistant_professor: finiteNumber(row.assistant_professor, `${label}.assistant_professor`),
  };
}

/** Strict parser used for published regulation JSON. Drafts may be edited as JSON,
 * but only documents accepted here can be published or executed. */
export function parseCapacityRuleSet(value: unknown): CapacityRuleSet {
  if (!value || typeof value !== "object") throw new Error("invalid capacity regulation");
  const root = value as Record<string, unknown>;
  const metadata = root.metadata as Record<string, unknown> | undefined;
  const tables = root.tables as Record<string, unknown> | undefined;
  const tableByDegree = root.tableByDegree as Record<string, unknown> | undefined;
  if (!metadata || !tables || !tableByDegree) throw new Error("capacity regulation is incomplete");

  const parseTable = (key: CapacityTable): CapacityTableRules => {
    const raw = tables[key] as Record<string, unknown> | undefined;
    if (!raw) throw new Error(`missing table ${key}`);
    return {
      title: nonEmptyString(raw.title, `${key}.title`),
      citation: nonEmptyString(raw.citation, `${key}.citation`),
      base: parseRankMap(raw.base, `${key}.base`),
      international: parseRankMap(raw.international, `${key}.international`),
    };
  };

  const degreeMap: Record<string, CapacityTable> = {};
  for (const [degree, table] of Object.entries(tableByDegree)) {
    if (table !== "dissertation" && table !== "thesis")
      throw new Error(`invalid degree table for ${degree}`);
    degreeMap[nonEmptyString(degree, "degree key")] = table;
  }

  const modifiersRaw = Array.isArray(root.modifiers) ? root.modifiers : [];
  const modifiers: CapacityModifier[] = modifiersRaw.map((item, index) => {
    const raw = item as Record<string, unknown>;
    return {
      id: nonEmptyString(raw.id, `modifiers[${index}].id`),
      citation: nonEmptyString(raw.citation, `modifiers[${index}].citation`),
      label: nonEmptyString(raw.label, `modifiers[${index}].label`),
      delta: finiteNumber(raw.delta, `modifiers[${index}].delta`),
      input: nonEmptyString(raw.input, `modifiers[${index}].input`) as CapacityInputId,
      when: nonEmptyString(raw.when, `modifiers[${index}].when`),
    };
  });

  const exclusionsRaw = Array.isArray(root.exclusions) ? root.exclusions : [];
  const exclusions: CapacityExclusion[] = exclusionsRaw.map((item, index) => {
    const raw = item as Record<string, unknown>;
    return {
      id: nonEmptyString(raw.id, `exclusions[${index}].id`),
      citation: nonEmptyString(raw.citation, `exclusions[${index}].citation`),
      label: nonEmptyString(raw.label, `exclusions[${index}].label`),
      input: nonEmptyString(raw.input, `exclusions[${index}].input`) as CapacityInputId,
    };
  });

  const inputsRaw = Array.isArray(root.inputs) ? root.inputs : [];
  const inputs: CapacityInput[] = inputsRaw.map((item, index) => {
    const raw = item as Record<string, unknown>;
    const availability = nonEmptyString(raw.availability, `inputs[${index}].availability`);
    if (
      !(["recorded", "derivable", "absent"] as const).includes(
        availability as CapacityInputAvailability,
      )
    ) {
      throw new Error(`invalid inputs[${index}].availability`);
    }
    return {
      id: nonEmptyString(raw.id, `inputs[${index}].id`) as CapacityInputId,
      label: nonEmptyString(raw.label, `inputs[${index}].label`),
      citation: nonEmptyString(raw.citation, `inputs[${index}].citation`),
      availability: availability as CapacityInputAvailability,
      supply: nonEmptyString(raw.supply, `inputs[${index}].supply`),
    };
  });

  /* These nested objects are intentionally validated against the known shape by
   * round-tripping through the bootstrap defaults. A future revision can change
   * values, not silently invent executable keys. */
  const research = root.researchTrackBonus as Record<string, unknown> | undefined;
  const weights = root.weights as Record<string, unknown> | undefined;
  const ceiling = root.concurrentCeiling as Record<string, unknown> | undefined;
  if (!research || !weights || !ceiling)
    throw new Error("capacity regulation rule blocks are incomplete");

  const normalized: CapacityRuleSet = {
    metadata: {
      revision: nonEmptyString(metadata.revision, "metadata.revision"),
      approvedAt: nonEmptyString(metadata.approvedAt, "metadata.approvedAt"),
      sitting: nonEmptyString(metadata.sitting, "metadata.sitting"),
      articles: finiteNumber(metadata.articles, "metadata.articles"),
      provisos: finiteNumber(metadata.provisos, "metadata.provisos"),
    },
    tables: { dissertation: parseTable("dissertation"), thesis: parseTable("thesis") },
    tableByDegree: degreeMap,
    modifiers,
    researchTrackBonus: {
      citation: nonEmptyString(research.citation, "researchTrackBonus.citation"),
      label: nonEmptyString(research.label, "researchTrackBonus.label"),
      delta: finiteNumber(research.delta, "researchTrackBonus.delta"),
      input: nonEmptyString(research.input, "researchTrackBonus.input") as CapacityInputId,
      when: nonEmptyString(research.when, "researchTrackBonus.when"),
      appliesToInternational: research.appliesToInternational === true,
    } as typeof RESEARCH_TRACK_BONUS,
    weights: {
      jointSupervision: {
        citation: nonEmptyString(
          (weights.jointSupervision as Record<string, unknown>)?.citation,
          "weights.jointSupervision.citation",
        ),
        label: nonEmptyString(
          (weights.jointSupervision as Record<string, unknown>)?.label,
          "weights.jointSupervision.label",
        ),
        factor: finiteNumber(
          (weights.jointSupervision as Record<string, unknown>)?.factor,
          "weights.jointSupervision.factor",
        ),
      },
      interdisciplinary: {
        citation: nonEmptyString(
          (weights.interdisciplinary as Record<string, unknown>)?.citation,
          "weights.interdisciplinary.citation",
        ),
        label: nonEmptyString(
          (weights.interdisciplinary as Record<string, unknown>)?.label,
          "weights.interdisciplinary.label",
        ),
        factor: finiteNumber(
          (weights.interdisciplinary as Record<string, unknown>)?.factor,
          "weights.interdisciplinary.factor",
        ),
      },
      externalSecondSupervisor: {
        citation: nonEmptyString(
          (weights.externalSecondSupervisor as Record<string, unknown>)?.citation,
          "weights.externalSecondSupervisor.citation",
        ),
        label: nonEmptyString(
          (weights.externalSecondSupervisor as Record<string, unknown>)?.label,
          "weights.externalSecondSupervisor.label",
        ),
        firstSupervisorFactor: finiteNumber(
          (weights.externalSecondSupervisor as Record<string, unknown>)?.firstSupervisorFactor,
          "weights.externalSecondSupervisor.firstSupervisorFactor",
        ),
      },
    } as typeof CAPACITY_WEIGHTS,
    exclusions,
    concurrentCeiling: {
      citation: nonEmptyString(ceiling.citation, "concurrentCeiling.citation"),
      label: nonEmptyString(ceiling.label, "concurrentCeiling.label"),
      factor: finiteNumber(ceiling.factor, "concurrentCeiling.factor"),
      exemptExclusion: nonEmptyString(ceiling.exemptExclusion, "concurrentCeiling.exemptExclusion"),
    } as typeof CONCURRENT_CEILING,
    inputs,
  };

  if (normalized.concurrentCeiling.factor <= 0 || normalized.concurrentCeiling.factor > 1)
    throw new Error("invalid concurrent ceiling factor");
  for (const table of Object.values(normalized.tables)) {
    for (const rank of ACADEMIC_RANKS) {
      if (table.base[rank] < 0 || table.international[rank] < 0)
        throw new Error("capacity values cannot be negative");
    }
  }
  return normalized;
}

export function capacityInputFromRules(rules: CapacityRuleSet, id: CapacityInputId): CapacityInput {
  const found = rules.inputs.find((input) => input.id === id);
  if (!found) throw new Error(`unknown capacity input: ${id}`);
  return found;
}

export function capacityTableForDegreeFromRules(
  rules: CapacityRuleSet,
  degree: unknown,
): CapacityTable | null {
  if (typeof degree !== "string") return null;
  return rules.tableByDegree[degree] ?? null;
}
