/**
 * The vocabularies an institution starts with.
 *
 * A *starting* set, not a fixed one. Every entry here is a row in `lookups`,
 * owned by one university and editable from Settings — which is the whole reason
 * these are rows rather than a TypeScript union. A university that offers eleven
 * degrees adds three; one that has never had a «دستیاری تخصصی» retires it. The
 * software has no opinion about either.
 *
 * The lists are deliberately short where they are institution-specific.
 * Departments and fields of study run to a few hundred rows at a real
 * university and every one of those rows is that university's own; shipping
 * somebody else's is not a head start, it is a list to delete.
 *
 * ── The nesting ─────────────────────────────────────────────────────────────
 *
 * `faculties` → `departments` → `fields_of_study` is a real containment, and it
 * is recorded rather than implied. Without it a clerk who picks «مهندسی» still
 * scrolls every department in the institution and can file a student in one
 * that faculty does not have — a record that is wrong in a way no validation
 * catches, because each field is individually valid.
 */

/* Relative, not `@/`. The seeder runs this file under plain `node`, which
   resolves neither the alias nor `tsconfig`'s paths — every other module under
   `src/db` is imported the same way, and for the same reason. */
import { toPersianDigits } from "../lib/digits.ts";

export interface VocabularyEntry {
  value: string;
  label: string;
  /** The `value` of the entry this one sits under, within its parent set. */
  parent?: string;
}

export interface VocabularySet {
  set: string;
  /** The set this one nests inside, if any. */
  parentSet?: string;
  entries: VocabularyEntry[];
}

export const VOCABULARY: VocabularySet[] = [
  /* ── Identity ─────────────────────────────────────────────────────────── */
  {
    set: "genders",
    entries: [
      { value: "male", label: "مرد" },
      { value: "female", label: "زن" },
    ],
  },
  {
    set: "marital_statuses",
    entries: [
      { value: "single", label: "مجرد" },
      { value: "married", label: "متأهل" },
      { value: "divorced", label: "مطلقه" },
      { value: "widowed", label: "همسر فوت‌شده" },
    ],
  },
  {
    set: "nationalities",
    entries: [
      { value: "iranian", label: "ایرانی" },
      { value: "afghan", label: "افغانستانی" },
      { value: "iraqi", label: "عراقی" },
      { value: "pakistani", label: "پاکستانی" },
      { value: "syrian", label: "سوری" },
      { value: "lebanese", label: "لبنانی" },
      { value: "turkish", label: "ترکیه‌ای" },
      { value: "other", label: "سایر" },
    ],
  },

  /* ── Academic standing ────────────────────────────────────────────────── */
  {
    set: "degrees",
    entries: [
      { value: "associate", label: "کاردانی" },
      { value: "bachelor", label: "کارشناسی" },
      { value: "master", label: "کارشناسی ارشد" },
      { value: "professional_doctorate", label: "دکتری حرفه‌ای" },
      { value: "phd", label: "دکتری تخصصی" },
      { value: "specialty", label: "دستیاری تخصصی" },
    ],
  },
  {
    /*
     * The academic ladder, in the ministry's four rungs.
     *
     * The values are spelled out — `assistant_professor`, not `assistant` —
     * because the supervision-capacity regulation types on them: its allowance
     * tables are keyed by rank, and a rank spelled differently in the register
     * than in the regulation is a professor with no allowance at all rather
     * than an error anybody sees.
     */
    set: "academic_ranks",
    entries: [
      { value: "instructor", label: "مربی" },
      { value: "assistant_professor", label: "استادیار" },
      { value: "associate_professor", label: "دانشیار" },
      { value: "full_professor", label: "استاد" },
    ],
  },
  {
    /*
     * A member of staff's standing, which is not the same question as their
     * contract type.
     *
     * `employment_statuses` says how somebody is engaged — «رسمی», «پیمانی».
     * This says whether they are currently available to the council at all: a
     * professor on sabbatical holds their rank and their contract and may not
     * be appointed to a panel, and the register has to be able to say so
     * without retiring the record.
     */
    set: "professor_statuses",
    entries: [
      { value: "active", label: "شاغل" },
      { value: "pending_retirement", label: "در انتظار بازنشستگی" },
      { value: "retired", label: "بازنشسته" },
      { value: "unpaid_leave", label: "مرخصی بدون حقوق" },
      { value: "sick_leave", label: "مرخصی استعلاجی" },
      { value: "study_leave", label: "اعزام به تحصیل" },
      { value: "on_mission", label: "مأموریت" },
      { value: "resigned", label: "استعفا داده" },
      { value: "dismissed", label: "انفصال از خدمت" },
      { value: "deceased", label: "فوت" },
    ],
  },

  /* ── Personnel ────────────────────────────────────────────────────────── */
  {
    /*
     * How somebody is engaged — the contract — as against
     * `professor_statuses`, which says whether they are at their post. Both
     * are reported, and reported separately, in every university return.
     */
    set: "employment_statuses",
    entries: [
      { value: "tenured", label: "رسمی قطعی" },
      { value: "tenure_track", label: "رسمی آزمایشی" },
      { value: "contract", label: "پیمانی" },
      { value: "temporary", label: "قراردادی" },
      { value: "visiting", label: "استاد مدعو" },
      { value: "retired", label: "بازنشسته" },
    ],
  },
  {
    /*
     * پایه — the salary step attached to a rank. Twenty of them, generated
     * rather than typed: they are the integers, and a hand-written list of
     * twenty near-identical rows is twenty chances to skip one.
     */
    set: "professor_grades",
    entries: Array.from({ length: 20 }, (_, index) => ({
      value: `step_${index + 1}`,
      label: `پایه ${toPersianDigits(String(index + 1))}`,
    })),
  },
  {
    set: "last_degrees",
    entries: [
      { value: "diploma", label: "دیپلم" },
      { value: "associate", label: "کاردانی" },
      { value: "bachelor", label: "کارشناسی" },
      { value: "master", label: "کارشناسی ارشد" },
      { value: "professional_doctorate", label: "دکتری حرفه‌ای" },
      { value: "phd", label: "دکتری تخصصی" },
      { value: "specialty", label: "تخصص" },
      { value: "subspecialty", label: "فوق تخصص" },
      { value: "fellowship", label: "فلوشیپ" },
      { value: "postdoc", label: "پسادکتری" },
    ],
  },
  {
    /*
     * ایثارگری. «هیچ‌کدام» is an entry rather than an empty box, because the
     * two are different facts: a record whose box is empty has not been asked,
     * and one marked «هیچ‌کدام» has been. Only the second is a return the
     * office can file.
     */
    set: "veteran_statuses",
    entries: [
      { value: "none", label: "هیچ‌کدام" },
      { value: "veteran_disabled", label: "جانباز" },
      { value: "freed_pow", label: "آزاده" },
      { value: "combatant", label: "رزمنده" },
      { value: "martyr_child", label: "فرزند شهید" },
      { value: "veteran_child", label: "فرزند جانباز" },
      { value: "freed_pow_child", label: "فرزند آزاده" },
      { value: "martyr_spouse", label: "همسر شهید" },
      { value: "veteran_spouse", label: "همسر جانباز" },
      { value: "mia_child", label: "فرزند مفقودالاثر" },
    ],
  },
  {
    set: "dependencies",
    entries: [
      { value: "independent", label: "مستقل" },
      { value: "msrt", label: "وزارت علوم، تحقیقات و فناوری" },
      { value: "mohme", label: "وزارت بهداشت، درمان و آموزش پزشکی" },
      { value: "armed_forces", label: "ستاد کل نیروهای مسلح" },
      { value: "presidency", label: "نهاد ریاست جمهوری" },
      { value: "astan_quds", label: "آستان قدس رضوی" },
      { value: "martyr_foundation", label: "بنیاد شهید و امور ایثارگران" },
      { value: "municipality", label: "شهرداری" },
      { value: "private", label: "بخش خصوصی" },
      { value: "other", label: "سایر نهادها" },
    ],
  },
  {
    /* What sort of place somebody serves in — as against `workplace_regions`
       below, which says where it is. Both are true of one person at once. */
    set: "workplaces",
    entries: [
      { value: "public_university", label: "دانشگاه دولتی" },
      { value: "azad_university", label: "دانشگاه آزاد" },
      { value: "payam_noor", label: "دانشگاه پیام نور" },
      { value: "nonprofit_university", label: "دانشگاه غیرانتفاعی" },
      { value: "higher_education_institute", label: "مؤسسه آموزش عالی" },
      { value: "research_institute", label: "پژوهشگاه" },
      { value: "research_center", label: "مرکز تحقیقات" },
      { value: "teaching_hospital", label: "بیمارستان آموزشی" },
      { value: "clinic", label: "کلینیک تخصصی" },
      { value: "knowledge_based_company", label: "شرکت دانش‌بنیان" },
      { value: "government_office", label: "ادارات دولتی" },
      { value: "private_company", label: "شرکت خصوصی" },
      { value: "retired", label: "بازنشسته" },
      { value: "other", label: "سایر" },
    ],
  },
  {
    set: "workplace_regions",
    entries: [
      { value: "in_province", label: "داخل استان" },
      { value: "out_of_province", label: "خارج استان" },
    ],
  },
  {
    /*
     * A short starting list, like `universities`. Every institution's payroll
     * runs through two or three of these and adds its own from Settings.
     */
    set: "banks",
    entries: [
      { value: "melli", label: "بانک ملی ایران" },
      { value: "mellat", label: "بانک ملت" },
      { value: "tejarat", label: "بانک تجارت" },
      { value: "saderat", label: "بانک صادرات ایران" },
      { value: "sepah", label: "بانک سپه" },
      { value: "keshavarzi", label: "بانک کشاورزی" },
      { value: "maskan", label: "بانک مسکن" },
      { value: "refah", label: "بانک رفاه کارگران" },
      { value: "parsian", label: "بانک پارسیان" },
      { value: "pasargad", label: "بانک پاسارگاد" },
      { value: "saman", label: "بانک سامان" },
      { value: "shahr", label: "بانک شهر" },
      { value: "other", label: "سایر بانک‌ها" },
    ],
  },
  {
    set: "student_statuses",
    /*
     * Enrolment state, and only that. The list these come from conflated a
     * standing with the event that produced it, so a student could be both
     * «فارغ‌التحصیل» and «انصراف» at once and the register could not say which
     * was current. Each state appears once and they are mutually exclusive.
     */
    entries: [
      { value: "enrolled", label: "در حال تحصیل" },
      { value: "on_leave", label: "مرخصی تحصیلی" },
      { value: "suspended", label: "تعلیق از تحصیل" },
      { value: "graduated", label: "فارغ‌التحصیل" },
      { value: "withdrawn", label: "انصراف" },
      { value: "dismissed", label: "اخراج" },
      { value: "transferred", label: "انتقالی" },
    ],
  },
  {
    set: "faculties",
    entries: [
      { value: "engineering", label: "مهندسی" },
      { value: "basic_sciences", label: "علوم پایه" },
      { value: "medicine", label: "پزشکی" },
      { value: "veterinary", label: "دامپزشکی" },
      { value: "dentistry", label: "دندانپزشکی" },
      { value: "pharmacy", label: "داروسازی" },
      { value: "nursing_midwifery", label: "پرستاری و مامایی" },
      { value: "agriculture", label: "کشاورزی" },
      { value: "natural_resources", label: "منابع طبیعی" },
      { value: "literature_humanities", label: "ادبیات و علوم انسانی" },
    ],
  },
  {
    set: "departments",
    parentSet: "faculties",
    entries: [
      { value: "computer_engineering", label: "مهندسی کامپیوتر", parent: "engineering" },
      { value: "electrical_engineering", label: "مهندسی برق", parent: "engineering" },
      { value: "mechanical_engineering", label: "مهندسی مکانیک", parent: "engineering" },
      { value: "civil_engineering", label: "مهندسی عمران", parent: "engineering" },
      { value: "chemical_engineering", label: "مهندسی شیمی", parent: "engineering" },
      { value: "mathematics", label: "ریاضی", parent: "basic_sciences" },
      { value: "physics", label: "فیزیک", parent: "basic_sciences" },
      { value: "chemistry", label: "شیمی", parent: "basic_sciences" },
      { value: "clinical_sciences", label: "علوم درمانگاهی", parent: "veterinary" },
      { value: "pathobiology", label: "پاتوبیولوژی", parent: "veterinary" },
    ],
  },
  {
    set: "fields_of_study",
    parentSet: "departments",
    entries: [
      { value: "computer_engineering", label: "مهندسی کامپیوتر", parent: "computer_engineering" },
      { value: "software_engineering", label: "مهندسی نرم‌افزار", parent: "computer_engineering" },
      { value: "veterinary_medicine", label: "دامپزشکی", parent: "clinical_sciences" },
      { value: "veterinary_surgery", label: "جراحی دامپزشکی", parent: "clinical_sciences" },
      { value: "animal_health", label: "بهداشت و بیماری‌های دام", parent: "pathobiology" },
      { value: "poultry_diseases", label: "بیماری‌های طیور", parent: "pathobiology" },
      { value: "veterinary_pathology", label: "پاتولوژی دامپزشکی", parent: "pathobiology" },
      { value: "microbiology", label: "میکروبیولوژی", parent: "pathobiology" },
      { value: "biotechnology", label: "بیوتکنولوژی", parent: "chemistry" },
    ],
  },

  /* ── Admission ────────────────────────────────────────────────────────── */
  {
    set: "admission_types",
    entries: [
      { value: "daily", label: "روزانه" },
      { value: "evening", label: "شبانه (نوبت دوم)" },
      { value: "self_funded_campus", label: "پردیس خودگردان" },
      { value: "azad", label: "آزاد" },
      { value: "payam_noor", label: "پیام نور" },
      { value: "virtual", label: "مجازی" },
      { value: "part_time", label: "نیمه‌حضوری" },
      { value: "in_service", label: "ضمن خدمت" },
    ],
  },
  {
    /*
     * Beside the admission route, not folded into it: «بورسیه» says who pays and
     * «کنکور» says how they got in, and the archive holds students for whom both
     * are true at once.
     */
    set: "funding_types",
    entries: [
      { value: "scholarship", label: "بورسیه" },
      { value: "self_funded", label: "غیر بورسیه" },
    ],
  },
  {
    set: "entry_methods",
    entries: [
      { value: "national_exam", label: "کنکور سراسری" },
      { value: "azad_exam", label: "کنکور آزاد" },
      { value: "academic_record", label: "سوابق تحصیلی" },
      { value: "without_exam", label: "پذیرش بدون آزمون" },
      { value: "talented", label: "استعداد درخشان" },
      { value: "olympiad", label: "المپیاد" },
      { value: "transfer", label: "انتقالی" },
      { value: "guest", label: "مهمان" },
      {
        /*
         * The route that exempts a student from the faculty's allocation: the
         * supervisor brought the funding, so the place is not drawn from the
         * institution's quota and the student costs their supervisor nothing.
         * The capacity screens read this exact value — see
         * `capacity/queries.ts`.
         */
        value: "supervisor_funded",
        label: "استاد محور",
      },
      { value: "other", label: "سایر روش‌ها" },
    ],
  },
  {
    set: "quotas",
    entries: [
      { value: "free", label: "آزاد" },
      { value: "region_1", label: "منطقه یک" },
      { value: "region_2", label: "منطقه دو" },
      { value: "region_3", label: "منطقه سه" },
      { value: "veterans", label: "ایثارگران" },
      { value: "combatants", label: "رزمندگان" },
      { value: "martyr_families", label: "شاهد" },
      { value: "talented", label: "استعداد درخشان" },
      { value: "religious_minority", label: "اقلیت‌های دینی" },
    ],
  },

  /* ── Military service ─────────────────────────────────────────────────── */
  {
    set: "military_statuses",
    entries: [
      { value: "completed", label: "پایان خدمت" },
      { value: "exempt", label: "معاف" },
      { value: "student_deferral", label: "معافیت تحصیلی" },
      { value: "serving", label: "در حال خدمت" },
      { value: "liable", label: "مشمول" },
      { value: "absent", label: "غایب از خدمت" },
      { value: "not_applicable", label: "مشمول نیست" },
    ],
  },
  {
    set: "military_status_types",
    entries: [
      { value: "service_card", label: "کارت پایان خدمت" },
      { value: "permanent", label: "معافیت دائم" },
      { value: "temporary", label: "معافیت موقت" },
      { value: "educational", label: "معافیت تحصیلی" },
      { value: "medical", label: "معافیت پزشکی" },
      { value: "dependency", label: "معافیت کفالت" },
      { value: "only_child", label: "معافیت تک‌فرزندی" },
      { value: "veteran", label: "معافیت ایثارگری" },
      { value: "conscript_assignment", label: "کارت امریه" },
    ],
  },
  {
    set: "military_letter_statuses",
    entries: [
      { value: "pending", label: "در انتظار ارسال" },
      { value: "sent", label: "ارسال شده" },
      { value: "received", label: "دریافت شده" },
      { value: "answered", label: "پاسخ داده شده" },
      { value: "follow_up", label: "نیاز به پیگیری" },
    ],
  },

  /* ── Prior degree ─────────────────────────────────────────────────────── */
  {
    set: "diploma_types",
    entries: [
      { value: "mathematics", label: "ریاضی و فیزیک" },
      { value: "experimental", label: "علوم تجربی" },
      { value: "humanities", label: "علوم انسانی" },
      { value: "islamic_studies", label: "علوم و معارف اسلامی" },
      { value: "technical", label: "فنی و حرفه‌ای" },
      { value: "work_knowledge", label: "کار و دانش" },
      { value: "art", label: "هنر" },
      { value: "other", label: "سایر" },
    ],
  },
  {
    set: "universities",
    entries: [
      { value: "ferdowsi", label: "دانشگاه فردوسی مشهد" },
      { value: "tehran", label: "دانشگاه تهران" },
      { value: "sharif", label: "دانشگاه صنعتی شریف" },
      { value: "amirkabir", label: "دانشگاه صنعتی امیرکبیر" },
      { value: "shiraz", label: "دانشگاه شیراز" },
      { value: "other", label: "سایر" },
    ],
  },
  /* ── The council ──────────────────────────────────────────────────────── */
  {
    /*
     * What stage of a student's work a decision is about. The council's own
     * ordering, which is also the order the stages happen in.
     */
    set: "decision_report_categories",
    entries: [
      { value: "thesis_proposal", label: "پیشنهاده پایان‌نامه" },
      { value: "dissertation_proposal", label: "پیشنهاده رساله" },
      { value: "thesis_final_defense", label: "دفاع نهایی پایان‌نامه" },
      { value: "dissertation_final_defense", label: "دفاع نهایی رساله" },
    ],
  },
  {
    set: "ruling_report_categories",
    entries: [
      { value: "thesis_changes", label: "درخواست تغییرات پایان‌نامه / رساله" },
      { value: "faculty_research", label: "تصویب / خاتمه طرح پژوهشی (هیئت علمی)" },
      { value: "research_collaboration", label: "تصویب همکاری پژوهشی (داخلی / خارجی)" },
      { value: "conference_request", label: "درخواست شرکت در همایش / کنگره" },
      { value: "other", label: "سایر" },
    ],
  },
  {
    set: "worksheet_categories",
    entries: [
      { value: "supervisor_selection", label: "انتخاب استاد راهنما" },
      { value: "proposal", label: "پیشنهاده" },
      { value: "proposal_defense", label: "دفاع از پیشنهاده" },
      { value: "defense_permit", label: "مجوز دفاع" },
      { value: "final_defense", label: "دفاع نهایی" },
    ],
  },
  {
    set: "council_review_statuses",
    entries: [
      { value: "pending", label: "در انتظار بررسی" },
      { value: "approved", label: "تأیید شده" },
      { value: "conditional", label: "نیاز به اصلاح" },
      { value: "re_review", label: "بررسی مجدد" },
      { value: "rejected", label: "رد شده" },
    ],
  },
  {
    set: "research_types",
    entries: [
      { value: "fundamental", label: "بنیادی" },
      { value: "applied", label: "کاربردی" },
      { value: "developmental", label: "توسعه‌ای" },
    ],
  },
  {
    /*
     * Weekdays are vocabulary values rather than free text. Stable Latin keys
     * keep filtering and storage independent from the institution's displayed
     * wording, while labels remain editable presentation data.
     */
    set: "weekdays",
    entries: [
      { value: "saturday", label: "شنبه" },
      { value: "sunday", label: "یک‌شنبه" },
      { value: "monday", label: "دوشنبه" },
      { value: "tuesday", label: "سه‌شنبه" },
      { value: "wednesday", label: "چهارشنبه" },
      { value: "thursday", label: "پنج‌شنبه" },
      { value: "friday", label: "جمعه" },
    ],
  },
  /* ── Workshops ────────────────────────────────────────────────────────── */
  {
    set: "workshop_statuses",
    entries: [
      { value: "planned", label: "برنامه‌ریزی‌شده" },
      { value: "open", label: "ثبت‌نام باز" },
      { value: "held", label: "برگزار شده" },
      { value: "cancelled", label: "لغو شده" },
    ],
  },
  {
    set: "workshop_locations",
    entries: [
      { value: "in_person", label: "حضوری" },
      { value: "online", label: "مجازی" },
      { value: "hybrid", label: "ترکیبی" },
    ],
  },
  {
    /*
     * Registration and attendance are different facts about one person, and the
     * certificate depends on the second. «ثبت‌نام کرده» is not «حاضر شده», and
     * a workshop that issued certificates to everybody who signed up is a
     * workshop whose certificates mean nothing.
     */
    set: "attendance_statuses",
    entries: [
      { value: "registered", label: "ثبت‌نام کرده" },
      { value: "attended", label: "حاضر" },
      { value: "absent", label: "غایب" },
      { value: "withdrawn", label: "انصراف" },
    ],
  },
  {
    set: "payment_statuses",
    entries: [
      { value: "free", label: "رایگان" },
      { value: "pending", label: "در انتظار پرداخت" },
      { value: "paid", label: "پرداخت شده" },
      { value: "waived", label: "معاف" },
    ],
  },
  {
    set: "instructor_roles",
    entries: [
      { value: "main", label: "مدرس اصلی" },
      { value: "assistant", label: "دستیار" },
      { value: "guest", label: "مهمان" },
    ],
  },
];

/** Every set name the vocabulary defines, for validating a lookup reference. */
export const VOCABULARY_SETS = VOCABULARY.map((entry) => entry.set);

/**
 * The vocabularies the *program* has an opinion about, and what that opinion is.
 *
 * ── The problem this names ──────────────────────────────────────────────────
 *
 * Almost every list here is the institution's: a university that offers eleven
 * degrees adds three, one that never ran «دستیاری تخصصی» retires it, and nothing
 * in the code notices or should. A few are not like that. The council's minute
 * has two lettered sections and the worksheet catalogue maps every report
 * category to a stage, so «دفاع نهایی» is not merely a label — it is a branch.
 * Retire it and the final-defence worksheet silently stops being offered; add a
 * sixth category and every decision filed under it lands in «بدون بخش» and gets
 * no form at all.
 *
 * Neither failure raises anything. Both look like the software having nothing to
 * say about a case, which is a state it legitimately has.
 *
 * ── Why this rather than moving the list into code ──────────────────────────
 *
 * The alternative is to take these sets out of `lookups` entirely and enumerate
 * them in TypeScript. That fixes the branching and loses four things that
 * currently work for free: the filter dropdowns, the chip colours, the register
 * sort (`byVocabulary` orders by the row's own `position`), and — the one that
 * matters most to an office — the ability to *reword* an entry. A university
 * that calls a proposal «پروپوزال» is entitled to see that word on its own
 * screens, and that is a decision about wording, not about what the software
 * does.
 *
 * So the rows stay, the label stays theirs, and this says which values they may
 * not take away. `value` was already immutable once written; what this adds is
 * the other two ways a set can change out from under the code.
 */
export interface CodeOwnedSet {
  /**
   * Values the program branches on by name. Retiring one changes behaviour.
   *
   * `vocabulary.test.ts` asserts each of these is actually in the set, so a
   * value renamed on one side and not the other fails before it ships.
   */
  required: readonly string[];
  /**
   * Whether the program enumerates the set exhaustively.
   *
   * `true` means every member is accounted for somewhere in the code and a new
   * one would fall through — so the office may not add to it. `false` means the
   * code cares about the named values and is indifferent to the rest: a
   * university with a seventh student standing is welcome to it, as long as
   * «در حال تحصیل» is still there to be counted.
   */
  closed: boolean;
}

export const CODE_OWNED: Record<string, CodeOwnedSet> = {
  /*
   * Closed. `modules/council/sittings.ts` sorts a sitting's business into the
   * minute's two lettered sections by category, and `modules/worksheets`
   * chooses which forms exist for a case the same way. There is no default
   * branch for either — deliberately, because a category nothing recognises is
   * reported as unfiled rather than quietly printed under the wrong heading.
   */
  decision_report_categories: {
    required: [
      "thesis_proposal",
      "dissertation_proposal",
      "thesis_final_defense",
      "dissertation_final_defense",
    ],
    closed: true,
  },
  ruling_report_categories: {
    required: [
      "thesis_changes",
      "faculty_research",
      "research_collaboration",
      "conference_request",
      "other",
    ],
    closed: true,
  },
  worksheet_categories: {
    required: [
      "supervisor_selection",
      "proposal",
      "proposal_defense",
      "defense_permit",
      "final_defense",
    ],
    closed: true,
  },
  /*
   * Open. Only «رد شده» is a branch: a rejected item is not minuted, because the
   * council saw it and turned it down. Any other outcome a university wants to
   * record is one more thing the minute lists.
   */
  council_review_statuses: { required: ["rejected"], closed: false },
  /*
   * Open. «در حال تحصیل» is what "enrolled" means on the dashboard, in the
   * sidebar's count and in every supervision-load figure. The other standings
   * are the office's business.
   */
  student_statuses: { required: ["enrolled"], closed: false },
  /*
   * Open. A certificate is issued to somebody who attended, and that is the
   * only one of these the code reads.
   */
  attendance_statuses: { required: ["attended"], closed: false },
};

/** Whether an entry may be withdrawn from the lists the office edits. */
export function isRequiredValue(set: string, value: string): boolean {
  return CODE_OWNED[set]?.required.includes(value) ?? false;
}

/** Whether the office may add an entry to this set at all. */
export function isClosedSet(set: string): boolean {
  return CODE_OWNED[set]?.closed ?? false;
}
