/**
 * Decision Templates - الگوهای متن مصوبات و تصمیمات متنی شورا
 *
 * الگوهای از پیش‌آماده برای تصمیمات متنی، تغییرات پایان‌نامه/رساله، طرح‌های پژوهشی و همایش‌ها
 */

export interface DecisionTemplate {
  id: string;
  name: string;
  template: string;
  placeholders: string[];
  description?: string;
}

export interface TemplatePart {
  type: "text" | "placeholder";
  content?: string | undefined;
  placeholderName?: string | undefined;
}

/**
 * Templates keyed only by the canonical ruling-category values stored by the
 * Web application. Labels are presentation data from the ruling vocabulary and
 * never act as data keys.
 */
const THESIS_CHANGE_TEMPLATES: DecisionTemplate[] = [
  {
    id: "add_member",
    name: "افزودن عضو جدید",
    template:
      'درخواست [نام استاد درخواست‌دهنده] مبنی بر افزودن [نام فرد جدید] [سمت فرد جدید] به عنوان [سمت درخواستی] پایان نامه [نام دانشجو] [مقطع تحصیلی] تحت عنوان "[عنوان پایان‌نامه]" با نظر مساعد داوران به تصویب رسید.',
    placeholders: [
      "نام استاد درخواست‌دهنده",
      "نام فرد جدید",
      "سمت فرد جدید",
      "سمت درخواستی",
      "نام دانشجو",
      "مقطع تحصیلی",
      "عنوان پایان‌نامه",
    ],
    description: "برای افزودن عضو جدید به تیم راهنمایی",
  },
  {
    id: "replace_member",
    name: "جایگزینی عضو",
    template:
      'درخواست [نام استاد درخواست‌دهنده] مبنی بر جایگزینی [نام استاد/فرد جدید] به جای [نام استاد/فرد جایگزین‌شده] به عنوان [سمت جدید] در پایان نامه [نام دانشجو] دانشجوی [مقطع تحصیلی] با عنوان "[عنوان پایان‌نامه]" به تصویب رسید.',
    placeholders: [
      "نام استاد درخواست‌دهنده",
      "نام استاد/فرد جدید",
      "نام استاد/فرد جایگزین‌شده",
      "سمت جدید",
      "نام دانشجو",
      "مقطع تحصیلی",
      "عنوان پایان‌نامه",
    ],
    description: "برای جایگزینی یک عضو با عضو دیگر",
  },
  {
    id: "change_method",
    name: "تغییر روش کار",
    template:
      'درخواست [نام استاد درخواست‌دهنده] مبنی بر تغییر روش کار پایان نامه [نام دانشجو] دانشجوی [مقطع تحصیلی] با عنوان "[عنوان پایان‌نامه]" با نظر مساعد داوران، تصویب شد.',
    placeholders: ["نام استاد درخواست‌دهنده", "نام دانشجو", "مقطع تحصیلی", "عنوان پایان‌نامه"],
    description: "برای تغییر روش کار پایان‌نامه",
  },
  {
    id: "apply_method_changes",
    name: "اعمال تغییرات در روش کار",
    template:
      'درخواست [نام استاد درخواست‌دهنده] مبنی بر اعمال تغییرات در روش کار پایان نامه [نام دانشجو] دانشجوی [مقطع تحصیلی] با عنوان "[عنوان پایان‌نامه]" با نظر مساعد داوران به تصویب رسید.',
    placeholders: ["نام استاد درخواست‌دهنده", "نام دانشجو", "مقطع تحصیلی", "عنوان پایان‌نامه"],
    description: "برای اعمال تغییرات در روش کار",
  },
  {
    id: "change_title",
    name: "تغییر عنوان",
    template:
      'درخواست [نام استاد درخواست‌دهنده] مبنی بر تغییر عنوان پایان نامه [نام دانشجو] دانشجوی [مقطع تحصیلی] از عنوان "[عنوان قدیمی]" به عنوان "[عنوان جدید]" با نظر مساعد داوران به تصویب رسید.',
    placeholders: [
      "نام استاد درخواست‌دهنده",
      "نام دانشجو",
      "مقطع تحصیلی",
      "عنوان قدیمی",
      "عنوان جدید",
    ],
    description: "برای تغییر عنوان پایان‌نامه",
  },
  {
    id: "change_material",
    name: "تغییر مواد/شرایط آزمایش",
    template:
      'درخواست [نام استاد درخواست‌دهنده] مبنی بر [شرح دلیل تغییر] و جایگزینی آن با [ماده/روش جدید] در پایان نامه [نام دانشجو] دانشجوی [مقطع تحصیلی] با عنوان "[عنوان پایان‌نامه]" با نظر مساعد داوران به تصویب رسید.',
    placeholders: [
      "نام استاد درخواست‌دهنده",
      "شرح دلیل تغییر",
      "ماده/روش جدید",
      "نام دانشجو",
      "مقطع تحصیلی",
      "عنوان پایان‌نامه",
    ],
    description: "برای تغییر مواد یا شرایط آزمایش",
  },
  {
    id: "add_names_to_article",
    name: "افزودن اسامی در مقاله مستخرج از پایان‌نامه",
    template:
      'درخواست [نام استاد درخواست‌دهنده] مبنی بر افزودن اسامی [اسامی و اطلاعات کامل افراد] در مقاله مستخرج از پایان نامه [نام دانشجو] دانشجوی [مقطع تحصیلی] با عنوان "[عنوان پایان‌نامه]" به تصویب رسید.',
    placeholders: [
      "نام استاد درخواست‌دهنده",
      "اسامی و اطلاعات کامل افراد",
      "نام دانشجو",
      "مقطع تحصیلی",
      "عنوان پایان‌نامه",
    ],
    description: "برای افزودن اسامی و اطلاعات افراد به مقاله مستخرج از پایان‌نامه",
  },
];

const FACULTY_RESEARCH_TEMPLATES: DecisionTemplate[] = [
  {
    id: "start_project_simple",
    name: "شروع طرح (ساده)",
    template:
      'شروع طرح شماره [شماره طرح] [نام استاد درخواست‌دهنده] با همکاری [نام همکاران] تحت عنوان "[عنوان طرح پژوهشی]" به تصویب رسید.',
    placeholders: ["شماره طرح", "نام استاد درخواست‌دهنده", "نام همکاران", "عنوان طرح پژوهشی"],
    description: "برای شروع طرح پژوهشی جدید",
  },
  {
    id: "start_project_evaluation",
    name: "شروع طرح (با ارزیابی)",
    template:
      'طرح شماره [شماره طرح] پیشنهادی [نام استاد درخواست‌دهنده] تحت عنوان "[عنوان طرح پژوهشی]" با همکاری [نام همکاران] و با توجه به ارزیابی طرح، به تصویب رسید.',
    placeholders: ["شماره طرح", "نام استاد درخواست‌دهنده", "عنوان طرح پژوهشی", "نام همکاران"],
    description: "برای شروع طرح با ارزیابی",
  },
  {
    id: "start_project_collaborators",
    name: "شروع طرح (با همکاران و داوری)",
    template:
      'بررسی شروع طرح شماره [شماره طرح] [نام استاد درخواست‌دهنده] تحت عنوان "[عنوان طرح پژوهشی]" با همکاری: [لیست همکاران] و نظر داوری به تصویب رسید.',
    placeholders: ["شماره طرح", "نام استاد درخواست‌دهنده", "عنوان طرح پژوهشی", "لیست همکاران"],
    description: "برای شروع طرح با همکاران و داوری",
  },
  {
    id: "end_project_article",
    name: "خاتمه طرح (با مقاله)",
    template:
      'بررسی خاتمه طرح شماره [شماره طرح] [نام استاد درخواست‌دهنده] تحت عنوان "[عنوان طرح پژوهشی]" با همکاری [نام همکاران] و با توجه به ارائه مقاله چاپ شده مستخرج از طرح به تصویب رسید.',
    placeholders: ["شماره طرح", "نام استاد درخواست‌دهنده", "عنوان طرح پژوهشی", "نام همکاران"],
    description: "برای خاتمه طرح با مقاله",
  },
  {
    id: "end_project_validation",
    name: "خاتمه طرح (با اعتبارسنجی)",
    template:
      'بررسی خاتمه طرح شماره [شماره طرح] [نام استاد درخواست‌دهنده] تحت عنوان "[عنوان طرح پژوهشی]" با همکاری [نام همکاران] و اعتبارسنجی مقاله مستخرج از طرح به تصویب رسید.',
    placeholders: ["شماره طرح", "نام استاد درخواست‌دهنده", "عنوان طرح پژوهشی", "نام همکاران"],
    description: "برای خاتمه طرح با اعتبارسنجی",
  },
];

const RESEARCH_COLLABORATION_TEMPLATES: DecisionTemplate[] = [
  {
    id: "collaboration_interdepartmental",
    name: "همکاری بین‌دانشکده‌ای (عضو همکار)",
    template:
      'درخواست [نام استاد درخواست‌دهنده] به عنوان همکار در طرح پژوهشی [نام دانشکده/دانشگاه همکار] با عنوان "[عنوان طرح پژوهشی]" به تصویب رسید.',
    placeholders: ["نام استاد درخواست‌دهنده", "نام دانشکده/دانشگاه همکار", "عنوان طرح پژوهشی"],
    description: "برای همکاری بین‌دانشکده‌ای به عنوان عضو همکار",
  },
  {
    id: "collaboration_joint_project",
    name: "همکاری بین‌دانشکده‌ای (طرح مشترک)",
    template:
      'درخواست [نام استاد درخواست‌دهنده] مبنی بر همکاری پژوهشی خود با [نام دانشگاه/موسسه همکار] را در قالب [تعداد] طرح پژوهشی تحت عنوان "[عنوان طرح پژوهشی]" به تصویب رسید.',
    placeholders: [
      "نام استاد درخواست‌دهنده",
      "نام دانشگاه/موسسه همکار",
      "تعداد",
      "عنوان طرح پژوهشی",
    ],
    description: "برای همکاری در قالب طرح مشترک",
  },
  {
    id: "collaboration_supervision",
    name: "همکاری بین‌دانشگاهی (راهنمایی دانشجو)",
    template:
      'درخواست [نام استاد درخواست‌دهنده] مبنی بر [سمت درخواستی] در طرح [نام دانشجو] دانشجوی [مقطع تحصیلی] [نام دانشگاه همکار] با عنوان "[عنوان رساله]"، به تصویب رسید.',
    placeholders: [
      "نام استاد درخواست‌دهنده",
      "سمت درخواستی",
      "نام دانشجو",
      "مقطع تحصیلی",
      "نام دانشگاه همکار",
      "عنوان رساله",
    ],
    description: "برای همکاری در راهنمایی دانشجو",
  },
  {
    id: "collaboration_international",
    name: "همکاری بین‌المللی",
    template:
      'درخواست همکاری بین‌المللی [نام استاد درخواست‌دهنده] به عنوان [سمت] پایان‌نامه [نوع پایان‌نامه] دانشجوی [مقطع تحصیلی] تحت عنوان "[عنوان]" به تصویب رسید.',
    placeholders: ["نام استاد درخواست‌دهنده", "سمت", "نوع پایان‌نامه", "مقطع تحصیلی", "عنوان"],
    description: "برای همکاری بین‌المللی",
  },
];

const CONFERENCE_REQUEST_TEMPLATES: DecisionTemplate[] = [
  {
    id: "conference_general",
    name: "شرکت در همایش (عمومی/خارجی)",
    template:
      "درخواست [نام استاد درخواست‌دهنده] مبنی بر شرکت در [نام همایش/کنگره] در [مکان همایش/کنگره] در تاریخ [تاریخ همایش] مطرح و به تصویب رسید.",
    placeholders: ["نام استاد درخواست‌دهنده", "نام همایش/کنگره", "مکان همایش/کنگره", "تاریخ همایش"],
    description: "برای شرکت در همایش عمومی یا خارجی",
  },
  {
    id: "conference_presentation",
    name: "شرکت در کنگره (ارائه مقاله/گروهی)",
    template:
      "درخواست آقایان [لیست اسامی اساتید] جهت شرکت در [نام همایش/کنگره] در [مکان همایش/کنگره] با ارائه [سمت در همایش] به تصویب رسید.",
    placeholders: ["لیست اسامی اساتید", "نام همایش/کنگره", "مکان همایش/کنگره", "سمت در همایش"],
    description: "برای شرکت در کنگره با ارائه مقاله یا به صورت گروهی",
  },
  {
    id: "conference_speaker",
    name: "شرکت در کنگره (سخنران/عضو پانل)",
    template:
      "درخواست [نام استاد درخواست‌دهنده] جهت شرکت در [نام همایش/کنگره] در [مکان همایش/کنگره] به عنوان [سمت در همایش] به تصویب رسید.",
    placeholders: ["نام استاد درخواست‌دهنده", "نام همایش/کنگره", "مکان همایش/کنگره", "سمت در همایش"],
    description: "برای شرکت به عنوان سخنران یا عضو پانل",
  },
];

export const DECISION_TEMPLATES: Record<string, DecisionTemplate[]> = {
  thesis_changes: THESIS_CHANGE_TEMPLATES,
  faculty_research: FACULTY_RESEARCH_TEMPLATES,
  research_collaboration: RESEARCH_COLLABORATION_TEMPLATES,
  conference_request: CONFERENCE_REQUEST_TEMPLATES,
};

/**
 * تجزیه متن تمپلیت به بخش‌های متنی و متغیرها
 */
export function parseTemplate(template: string): TemplatePart[] {
  const parts: TemplatePart[] = [];
  const regex = /\[(.*?)\]/g;
  let lastIndex = 0;
  let match = regex.exec(template);

  while (match !== null) {
    if (match.index > lastIndex) {
      parts.push({
        type: "text",
        content: template.substring(lastIndex, match.index),
      });
    }

    parts.push({
      type: "placeholder",
      placeholderName: match[1],
    });

    lastIndex = regex.lastIndex;
    match = regex.exec(template);
  }

  if (lastIndex < template.length) {
    const remainingText = template.substring(lastIndex);
    if (remainingText.trim() || parts.length === 0) {
      parts.push({ type: "text", content: remainingText });
    }
  }

  return parts;
}

export function isTitlePlaceholder(placeholderName: string): boolean {
  const titleKeywords = ["عنوان طرح پژوهشی", "عنوان رساله", "عنوان", "عنوان پایان‌نامه"];
  return titleKeywords.some((keyword) => placeholderName.includes(keyword));
}

/**
 * تولید متن نهایی از تمپلیت و مقادیر متغیرها
 */
export function generateFinalText(template: string, values: Record<string, string>): string {
  const parts = parseTemplate(template);
  let result = "";

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    if (part.type === "text") {
      result += part.content ?? "";
    } else {
      const placeholderName = part.placeholderName || "";
      let value = values[placeholderName] ?? "";

      // افزودن پیشوند دکتر در صورت نیاز
      const isProf = [
        "نام استاد",
        "نام فرد جدید",
        "نام استاد/فرد",
        "لیست اسامی اساتید",
        "استاد درخواست‌دهنده",
      ].some((kw) => placeholderName.includes(kw));

      if (value && isProf) {
        const trimmed = value.trim();
        if (trimmed && !trimmed.startsWith("دکتر") && !trimmed.startsWith("دكتر")) {
          value = `دکتر ${trimmed}`;
        }
      }

      result += value;
    }
  }

  return result.replace(/\s{2,}/g, " ").trim();
}

/**
 * استخراج مقادیر متغیرها از روی متن نهایی بر اساس ساختار الگو
 */
export function extractValuesFromText(
  template: string,
  text: string,
  placeholders: string[],
): Record<string, string> {
  if (!text || !template || placeholders.length === 0) return {};

  const parts = parseTemplate(template);
  if (parts.length === 0) return {};

  let regexPattern = "^";
  const placeholderNames: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;

    if (part.type === "text") {
      const escaped = (part.content ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const flexibleWhitespace = escaped.replace(/\s+/g, "\\s+");
      regexPattern += flexibleWhitespace;
    } else {
      placeholderNames.push(part.placeholderName ?? "");
      regexPattern += "(.*?)";
    }
  }
  regexPattern += "$";

  try {
    const regex = new RegExp(regexPattern, "s");
    const match = text.trim().match(regex);
    if (!match) return {};

    const values: Record<string, string> = {};
    for (let i = 0; i < placeholderNames.length; i++) {
      const name = placeholderNames[i];
      if (name) {
        let val = (match[i + 1] ?? "").trim();
        if (
          [
            "نام استاد",
            "نام فرد جدید",
            "نام استاد/فرد",
            "لیست اسامی اساتید",
            "استاد درخواست‌دهنده",
          ].some((kw) => name.includes(kw))
        ) {
          val = val.replace(/^(دکتر|دكتر)\s+/, "");
        }
        values[name] = val;
      }
    }
    return values;
  } catch {
    return {};
  }
}
