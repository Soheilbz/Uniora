import { format } from "date-fns-jalali";
import { toPersianDigits } from "./digits";

/**
 * Maps database field names to natural, clean Persian labels.
 */
const FIELD_TRANSLATIONS: Record<string, string> = {
  // مشخصات هویتی و فردی
  firstName: "نام",
  first_name: "نام",
  lastName: "نام خانوادگی",
  last_name: "نام خانوادگی",
  studentNumber: "شماره دانشجویی",
  student_number: "شماره دانشجویی",
  nationalId: "کد ملی",
  national_id: "کد ملی",
  idNumber: "شماره شناسنامه",
  id_number: "شماره شناسنامه",
  passportNumber: "شماره گذرنامه",
  passport_number: "شماره گذرنامه",
  fatherName: "نام پدر",
  father_name: "نام پدر",
  gender: "جنسیت",
  maritalStatus: "وضعیت تأهل",
  marital_status: "وضعیت تأهل",
  nationality: "ملیت",
  birthDate: "تاریخ تولد",
  birth_date: "تاریخ تولد",
  birthYear: "سال تولد",
  birth_year: "سال تولد",
  birthPlace: "محل تولد",
  birth_place: "محل تولد",
  militaryStatus: "وضعیت نظام وظیفه",
  military_status: "وضعیت نظام وظیفه",
  militaryStatusType: "نوع معافیت / خدمت",
  military_status_type: "نوع معافیت / خدمت",
  militaryLetterStatus: "وضعیت نامه نظام وظیفه",
  military_letter_status: "وضعیت نامه نظام وظیفه",
  veteranStatus: "وضعیت ایثارگری",
  veteran_status: "وضعیت ایثارگری",

  // دانشگاه و تحصیل
  degree: "مقطع تحصیلی",
  status: "وضعیت تحصیلی / فعالیت",
  faculty: "دانشکده",
  department: "گروه آموزشی",
  fieldOfStudy: "رشته تحصیلی",
  field_of_study: "رشته تحصیلی",
  admissionDate: "تاریخ پذیرش / ورود",
  admission_date: "تاریخ پذیرش / ورود",
  admissionType: "شیوه پذیرش",
  admission_type: "شیوه پذیرش",
  entryMethod: "روش ورود",
  entry_method: "روش ورود",
  fundingType: "نوع تأمین مالی و شهریه",
  funding_type: "نوع تأمین مالی و شهریه",
  quota: "سهمیه",
  sourceUniversity: "دانشگاه مبدأ",
  source_university: "دانشگاه مبدأ",
  primarySupervisorId: "استاد راهنمای اول",
  primary_supervisor_id: "استاد راهنمای اول",
  secondarySupervisorId: "استاد راهنمای دوم",
  secondary_supervisor_id: "استاد راهنمای دوم",
  thirdSupervisorId: "استاد راهنمای سوم",
  third_supervisor_id: "استاد راهنمای سوم",
  advisorId: "استاد مشاور",
  advisor_id: "استاد مشاور",

  // سوابق تحصیلی
  previousUniversity: "دانشگاه مقطع قبلی",
  previous_university: "دانشگاه مقطع قبلی",
  previousStudentNumber: "شماره دانشجویی مقطع قبلی",
  previous_student_number: "شماره دانشجویی مقطع قبلی",
  previousField: "رشته مقطع قبلی",
  previous_field: "رشته مقطع قبلی",
  previousGpa: "معدل مقطع قبلی",
  previous_gpa: "معدل مقطع قبلی",
  previousGraduationDate: "تاریخ فراغت از تحصیل مقطع قبلی",
  previous_graduation_date: "تاریخ فراغت از تحصیل مقطع قبلی",
  previousGraduationConfirmed: "تأیید فراغت از تحصیل مقطع قبلی",
  previous_graduation_confirmed: "تأیید فراغت از تحصیل مقطع قبلی",
  overallGpa: "معدل کل",
  overall_gpa: "معدل کل",
  diplomaType: "نوع مدرک دیپلم",
  diploma_type: "نوع مدرک دیپلم",
  diplomaGpa: "معدل کل دیپلم",
  diploma_gpa: "معدل کل دیپلم",
  diplomaWrittenGpa: "معدل کتبی دیپلم",
  diploma_written_gpa: "معدل کتبی دیپلم",
  completedUnits: "واحدهای گذرانده",
  completed_units: "واحدهای گذرانده",
  currentSemesterUnits: "واحدهای ترم جاری",
  current_semester_units: "واحدهای ترم جاری",
  semestersCount: "تعداد نیم‌سال‌ها",
  semesters_count: "تعداد نیم‌سال‌ها",
  academicStatusIncluded: "شامل وضعیت تحصیلی",
  academic_status_included: "شامل وضعیت تحصیلی",
  academicStatusExcluded: "مستثنی از وضعیت تحصیلی",
  academic_status_excluded: "مستثنی از وضعیت تحصیلی",
  bioethicsCode: "کد اخلاق زیستی",
  bioethics_code: "کد اخلاق زیستی",

  // اساتید و هیئت علمی
  personnelCode: "کد پرسنلی",
  personnel_code: "کد پرسنلی",
  academicRank: "مرتبه علمی",
  academic_rank: "مرتبه علمی",
  professorGrade: "پایه استاد",
  professor_grade: "پایه استاد",
  employmentStatus: "وضعیت استخدامی",
  employment_status: "وضعیت استخدامی",
  workplace: "محل خدمت",
  workplaceRegion: "منطقه خدمت",
  workplace_region: "منطقه خدمت",
  bankName: "نام بانک",
  bank_name: "نام بانک",
  accountNumber: "شماره حساب",
  account_number: "شماره حساب",
  iban: "شماره شبا (IBAN)",
  taxExempt: "معافیت مالیاتی",
  tax_exempt: "معافیت مالیاتی",
  taxDeductionPercent: "درصد کسر مالیات",
  tax_deduction_percent: "درصد کسر مالیات",

  // شورا و جلسات
  meetingNumber: "شماره جلسه",
  meeting_number: "شماره جلسه",
  meetingDate: "تاریخ جلسه",
  meeting_date: "تاریخ جلسه",
  meetingTime: "ساعت جلسه",
  meeting_time: "ساعت جلسه",
  location: "محل تشکیل",
  councilType: "نوع شورا",
  council_type: "نوع شورا",
  agenda: "دستور جلسه",
  minutes: "صورت‌جلسه",
  decisionNumber: "شماره مصوبه",
  decision_number: "شماره مصوبه",
  reviewStatus: "وضعیت بررسی",
  review_status: "وضعیت بررسی",
  reportCategory: "دسته‌بندی گزارش",
  report_category: "دسته‌بندی گزارش",

  // کارگاه‌ها
  workshopDate: "تاریخ کارگاه",
  workshop_date: "تاریخ کارگاه",
  workshopLocation: "محل کارگاه",
  workshop_location: "محل کارگاه",
  capacity: "ظرفیت",
  instructor: "مدرس",

  // تماس و آدرس
  phone: "شماره تلفن همراه",
  tel: "تلفن ثابت",
  email: "رایانامه (ایمیل)",
  address: "نشانی",
  postalCode: "کد پستی",
  postal_code: "کد پستی",

  // عمومی و سیستمی
  title: "عنوان",
  name: "نام کاربری / نام",
  username: "نام کاربری",
  displayUsername: "نام نمایشی",
  display_username: "نام نمایشی",
  roles: "نقش‌های دسترسی",
  role: "نقش دسترسی",
  suspendedAt: "زمان تعلیق",
  suspended_at: "زمان تعلیق",
  suspendedReason: "دلیل تعلیق",
  suspended_reason: "دلیل تعلیق",
  import: "درون‌ریزی از فایل",
  attempt: "دفعات تلاش ورود",
  description: "توضیحات",
  notes: "یادداشت‌ها",
  notesOffice: "یادداشت‌های دفتر",
  notes_office: "یادداشت‌های دفتر",
};

/**
 * Common lookup value mappings for display.
 */
const VALUE_TRANSLATIONS: Record<string, string> = {
  // جنسیت
  male: "مرد",
  female: "زن",

  // وضعیت تأهل
  single: "مجرد",
  married: "متأهل",
  divorced: "مطلقه",
  widowed: "همسر فوت‌شده",

  // مقاطع
  associate: "کاردانی",
  bachelor: "کارشناسی",
  master: "کارشناسی ارشد",
  professional_doctorate: "دکتری حرفه‌ای",
  phd: "دکتری تخصصی",
  specialty: "دستیاری تخصصی",

  // مراتب علمی
  instructor: "مربی",
  assistant_professor: "استادیار",
  associate_professor: "دانشیار",
  full_professor: "استاد",

  // وضعیت‌های دانشجو
  enrolled: "شاغل به تحصیل",
  graduated: "فارغ‌التحصیل",
  withdrawn: "انصرافی",
  expelled: "اخراجی",
  guest: "مهمان",
  transferred: "انتقالی",
  academic_leave: "مرخصی تحصیلی",

  // وضعیت‌های اساتید
  active: "شاغل",
  retired: "بازنشسته",
  pending_retirement: "در انتظار بازنشستگی",
  unpaid_leave: "مرخصی بدون حقوق",
  sick_leave: "مرخصی استعلاجی",
  study_leave: "اعزام به تحصیل",
  on_mission: "مأموریت",
  resigned: "استعفا",

  // دانشکده‌ها و گروه‌ها
  engineering: "مهندسی",
  basic_sciences: "علوم پایه",
  medicine: "پزشکی",
  veterinary: "دامپزشکی",
  dentistry: "دندانپزشکی",
  pharmacy: "داروسازی",
  agriculture: "کشاورزی",
  computer_engineering: "مهندسی کامپیوتر",
  software_engineering: "مهندسی نرم‌افزار",
  electrical_engineering: "مهندسی برق",
  mechanical_engineering: "مهندسی مکانیک",
  civil_engineering: "مهندسی عمران",
  chemical_engineering: "مهندسی شیمی",
  mathematics: "ریاضی",
  physics: "فیزیک",
  chemistry: "شیمی",
  clinical_sciences: "علوم درمانگاهی",
  pathobiology: "پاتوبیولوژی",
  veterinary_medicine: "دامپزشکی",
  biotechnology: "بیوتکنولوژی",
  animal_health: "بهداشت و بیماری‌های دام",

  // بولین
  true: "بله",
  false: "خیر",
  null: "خالی",
  undefined: "خالی",
};

/**
 * Translates a field name into natural Persian.
 */
export function translateField(field: string, locale = "fa"): string {
  if (!locale.toLowerCase().startsWith("fa")) {
    return field
      .replace(/([A-Z])/g, " $1")
      .replace(/_/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^./, (letter) => letter.toUpperCase());
  }
  if (FIELD_TRANSLATIONS[field]) {
    return FIELD_TRANSLATIONS[field];
  }
  const clean = field.replace(/\s+/g, "");
  const camel = clean.charAt(0).toLowerCase() + clean.slice(1);
  if (FIELD_TRANSLATIONS[camel]) {
    return FIELD_TRANSLATIONS[camel];
  }
  const snake = field
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_/, "");
  if (FIELD_TRANSLATIONS[snake]) {
    return FIELD_TRANSLATIONS[snake];
  }
  return field
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .trim();
}

/**
 * Formats a value for display in the audit trail.
 */
export function formatAuditValue(value: unknown, locale = "fa"): string {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  const persian = locale.toLowerCase().startsWith("fa");
  if (typeof value === "boolean") {
    return persian ? (value ? "بله" : "خیر") : value ? "Yes" : "No";
  }

  const str = String(value).trim();
  if (!persian) {
    if (/^line\s+(\d+)$/i.test(str)) {
      return `File row ${str.match(/^line\s+(\d+)$/i)?.[1] ?? ""}`;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    return str.replace(/_/g, " ");
  }

  // If it's a known lookup value
  if (VALUE_TRANSLATIONS[str]) {
    return VALUE_TRANSLATIONS[str];
  }

  // If it's import line indicator (e.g. "line 5")
  if (/^line\s+(\d+)$/i.test(str)) {
    const match = str.match(/^line\s+(\d+)$/i);
    return `ردیف ${toPersianDigits(match?.[1] ?? "")} فایل`;
  }

  // If it matches ISO date format (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    try {
      const d = new Date(str);
      if (!Number.isNaN(d.getTime())) {
        return toPersianDigits(format(d, "yyyy/MM/dd"));
      }
    } catch {
      // Fallback
    }
  }

  return toPersianDigits(str);
}

/**
 * Formats a Date object to a clean Jalali timestamp with Persian numerals.
 * Example: ۱۴۰۵/۰۶/۰۲ ساعت ۰۹:۰۸
 */
export function formatJalaliDateTime(date: Date | string, locale = "fa"): string {
  try {
    const d = typeof date === "string" ? new Date(date) : date;
    if (Number.isNaN(d.getTime())) return String(date);
    if (!locale.toLowerCase().startsWith("fa")) {
      return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(d);
    }
    const datePart = format(d, "yyyy/MM/dd");
    const timePart = format(d, "HH:mm");
    return toPersianDigits(`${datePart} - ساعت ${timePart}`);
  } catch {
    return String(date);
  }
}
