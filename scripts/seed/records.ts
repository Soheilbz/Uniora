import { eq } from "drizzle-orm";
import type { adminDb } from "../../src/db/admin.ts";
import * as schema from "../../src/db/schema.ts";
import { nationalId } from "./helpers.ts";

export async function seedRecords(db: ReturnType<typeof adminDb>, tenantId: string) {
  const existing = await db
    .select({ id: schema.students.id })
    .from(schema.students)
    .where(eq(schema.students.tenantId, tenantId))
    .limit(1);

  if (existing[0]) {
    console.log("records already present");
    return;
  }

  /*
   * Professors first: a student's supervision columns are real foreign keys, so
   * the directory has to exist before anyone can be attached to it.
   */
  const faculty = await db
    .insert(schema.professors)
    .values([
      /*
       * `isFacultyMember` deliberately carries all three of its states across
       * these four. It is the one column on this register where «not recorded»
       * is a distinct answer from «no» — a directory transcribed from personnel
       * files has rows nobody ever asked — and a sample that answers it
       * everywhere is a sample that never shows the third rendering.
       */
      {
        tenantId,
        professorCode: "101",
        firstName: "سعید",
        lastName: "نظیفی",
        academicRank: "full_professor",
        isFacultyMember: "yes",
        specialization: "بیماری‌های داخلی دام‌های بزرگ",
      },
      {
        tenantId,
        professorCode: "102",
        firstName: "فاطمه",
        lastName: "حسینی",
        academicRank: "associate_professor",
        isFacultyMember: "yes",
        specialization: "بیماری‌های داخلی دام‌های بزرگ",
      },
      {
        tenantId,
        professorCode: "103",
        firstName: "محمدرضا",
        lastName: "اکبری",
        academicRank: "assistant_professor",
        isFacultyMember: "no",
        specialization: "جراحی دامپزشکی",
      },
      {
        tenantId,
        professorCode: "104",
        firstName: "لیلا",
        lastName: "موسوی",
        academicRank: "associate_professor",
        specialization: "مامایی و بیماری‌های تولید مثل",
      },
    ])
    .returning({ id: schema.professors.id });

  /*
   * A cohort rather than three rows.
   *
   * Twenty-six is not arbitrary: the register pages at ten, so anything smaller
   * proves the table renders and proves nothing about the pager, the sort order
   * carrying across a page boundary, or a filter that narrows a result set to
   * fewer rows than the page it is currently on. Every one of those has been a
   * bug in a register at some point.
   *
   * Generated from lists rather than written out, and generated *deterministically*
   * — no random anything. A seed that differs between two runs is a seed that
   * cannot be used to reproduce what somebody is looking at.
   */
  const givenNames = [
    ["مریم", "female"],
    ["علی", "male"],
    ["زهرا", "female"],
    ["حسین", "male"],
    ["فاطمه", "female"],
    ["محمد", "male"],
    ["نرگس", "female"],
    ["رضا", "male"],
    ["سمیه", "female"],
    ["امیر", "male"],
    ["الهام", "female"],
    ["مهدی", "male"],
    ["پریسا", "female"],
  ] as const;
  const familyNames = [
    "رضایی",
    "محمدی",
    "کریمی",
    "احمدی",
    "حسینی",
    "موسوی",
    "جعفری",
    "صادقی",
    "قاسمی",
    "نوری",
    "شریفی",
    "بهرامی",
    "یزدانی",
  ];
  const placements = [
    { faculty: "engineering", department: "computer_engineering", field: "computer_engineering" },
    { faculty: "engineering", department: "computer_engineering", field: "software_engineering" },
    { faculty: "veterinary", department: "clinical_sciences", field: "veterinary_medicine" },
    { faculty: "veterinary", department: "pathobiology", field: "animal_health" },
    { faculty: "basic_sciences", department: "chemistry", field: "biotechnology" },
  ];
  const degrees = ["phd", "master", "bachelor", "professional_doctorate"];
  const statuses = ["enrolled", "enrolled", "enrolled", "on_leave", "graduated", "withdrawn"];

  /**
   * `array[i % array.length]`, with the type system convinced.
   *
   * `noUncheckedIndexedAccess` is on, so every indexed read is `T | undefined`
   * even where the modulo makes that impossible. Silencing it with `!` on each
   * of the eight call sites below would also silence the case where the array
   * is genuinely empty, which is a real way to seed twenty-six records with no
   * supervisor and notice weeks later.
   */
  function cycle<T>(items: readonly T[], index: number): T {
    const item = items[index % items.length];
    if (item === undefined) throw new Error("cycle() over an empty list");
    return item;
  }

  const cohort = Array.from({ length: 26 }, (_, index) => {
    const [firstName, gender] = cycle(givenNames, index);
    const placement = cycle(placements, index);
    const supervisor = cycle(faculty, index);
    // A second supervisor on some records and not others: the register renders
    // one, two or none, and all three have to be laid out.
    const second = index % 3 === 0 ? cycle(faculty, index + 1) : undefined;

    return {
      tenantId,
      studentNumber: `400${String(12345 + index).padStart(5, "0")}`,
      nationalId: nationalId(12345678 + index * 137),
      firstName,
      lastName: cycle(familyNames, index),
      fatherName: "محمد",
      gender,
      nationality: "iranian",
      maritalStatus: index % 4 === 0 ? "married" : "single",
      birthYear: 1370 + (index % 12),
      degree: cycle(degrees, index),
      status: cycle(statuses, index),
      admissionDate: `202${3 + (index % 3)}-09-23`,
      faculty: placement.faculty,
      department: placement.department,
      fieldOfStudy: placement.field,
      primarySupervisorId: supervisor.id,
      secondarySupervisorId: second?.id,
      advisorId: index % 5 === 0 ? cycle(faculty, index + 2).id : undefined,
      admissionType: index % 2 === 0 ? "daily" : "evening",
      /*
       * One in seven is supervisor-funded — «استاد محور» — which costs their
       * supervisor nothing against the faculty's allocation. Seeded so the
       * capacity screen has a student that must count as zero; a load
       * computation that simply counted rows would look right without it.
       */
      entryMethod:
        index % 7 === 0 ? "supervisor_funded" : index % 3 === 0 ? "national_exam" : "without_exam",
      quota: index % 4 === 0 ? "region_1" : "free",
      phone: `0912${String(1000000 + index * 4321).slice(0, 7)}`,
      email: `s400${12345 + index}@univ.local`,
      overallGpa: (15 + (index % 5) + index / 100).toFixed(2),
      completedUnits: 12 + index,
      semestersCount: 1 + (index % 8),
    };
  });

  await db.insert(schema.students).values(cohort);

  await db.insert(schema.councilDecisions).values([
    {
      tenantId,
      /* Council meeting numbers are stored canonically as ASCII digits so joins,
         filters and exports use one representation. */
      meetingNumber: "680",
      meetingDate: "2026-05-05",
      studentNumber: "40012345",
      studentName: "مریم رضایی",
      thesisTitle: "بررسی روش‌های یادگیری عمیق در تشخیص تصویر پزشکی",
      reportCategory: "thesis_proposal",
    },
    {
      tenantId,
      meetingNumber: "679",
      meetingDate: "2026-04-20",
      studentNumber: "40012346",
      studentName: "علی محمدی",
      thesisTitle: "طراحی سامانه‌ی توزیع‌شده برای پردازش داده‌های حجیم",
      reportCategory: "thesis_final_defense",
    },
    {
      tenantId,
      meetingNumber: "679",
      meetingDate: "2026-04-20",
      studentNumber: "40012347",
      studentName: "زهرا کریمی",
      thesisTitle: "مدل‌سازی رفتار حرارتی در سازه‌های بتنی",
      reportCategory: "thesis_proposal",
    },
  ]);

  console.log();
}
