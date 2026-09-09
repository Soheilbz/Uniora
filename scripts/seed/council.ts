import { eq, sql } from "drizzle-orm";
import type { adminDb } from "../../src/db/admin.ts";
import * as schema from "../../src/db/schema.ts";
import { isoDaysFromToday } from "./helpers.ts";

export async function seedCouncil(db: ReturnType<typeof adminDb>, tenantId: string) {
  const existing = await db
    .select({ id: schema.councilMeetings.id })
    .from(schema.councilMeetings)
    .where(eq(schema.councilMeetings.tenantId, tenantId))
    .limit(1);
  if (existing[0]) {
    console.log("council already present");
    return;
  }

  const roster = [
    "دکتر سعید نظیفی",
    "دکتر فاطمه حسینی",
    "دکتر محمدرضا اکبری",
    "دکتر لیلا موسوی",
    "نماینده‌ی اداره آموزش",
  ];

  const sittings = [
    { number: "678", date: "2026-02-16", day: "monday", absent: 1, standIn: undefined },
    { number: "679", date: "2026-04-20", day: "monday", absent: 0, standIn: undefined },
    {
      number: "680",
      date: "2026-05-05",
      day: "tuesday",
      absent: 2,
      /* One of the two who did not come sent somebody: the seat was filled, so
         this sitting is minuted with one absentee, not two. */
      standIn: { "دکتر لیلا موسوی": "دکتر مریم رستمی" },
    },
    /*
     * An extraordinary sitting, minuted the way the office minutes one. It is
     * the reason `meeting_number` is `text`: an integer column would reject this
     * row, and it is a real sitting with real decisions in it.
     */
    {
      number: "681 (فوق‌العاده)",
      date: "2026-06-09",
      day: "tuesday",
      absent: 1,
      standIn: undefined,
    },
    { number: "682", date: "2026-07-14", day: "sunday", absent: 0, standIn: undefined },
  ];

  const meetings = await db
    .insert(schema.councilMeetings)
    .values(
      sittings.map((sitting) => ({
        tenantId,
        meetingNumber: sitting.number,
        meetingDate: sitting.date,
        /* ASCII, like every other identifier and figure this schema stores. The
         screens localise on the way out — see `toLocaleDigits`. A column holding
         Persian digits is a column two different writers will disagree about. */
        meetingTime: "10:00",
        meetingDay: sitting.day,
        meetingLocation: "سالن شورای دانشکده",
        researchDeputy: "دکتر سعید نظیفی",
        participants: roster.slice(0, roster.length - sitting.absent),
        absentees: sitting.absent > 0 ? roster.slice(roster.length - sitting.absent) : [],
        /*
         * One sitting with a stand-in on file, so the rule that a represented
         * seat is not an empty one has something to demonstrate — and so the
         * register's attendance column and the sitting's own record can be seen
         * to agree about it.
         */
        substitutions: sitting.standIn ?? {},
        notes:
          sitting.number === "680"
            ? "پیگیری مصوبات جلسه‌ی پیشین\nبررسی ظرفیت راهنمایی نیم‌سال آینده"
            : null,
      })),
    )
    .returning({
      id: schema.councilMeetings.id,
      meetingNumber: schema.councilMeetings.meetingNumber,
    });

  /* The council's standing roster: the same names its attendance lists are
     seeded from, in the order the council reads them out. */
  await db.insert(schema.councilPermanentMembers).values(
    roster.map((memberName, index) => ({
      tenantId,
      memberName,
      sortOrder: index + 1,
    })),
  );

  /*
   * Each seat attached to the directory row it belongs to, matched the way the
   * office would match it: on the folded name, with the honorific stripped. The
   * roster writes «دکتر لیلا موسوی» and the directory holds «لیلا موسوی», and
   * `app.fold_person` is what makes the two the same person whichever yeh was
   * typed.
   *
   * The education-office representative matches nothing and stays unlinked,
   * which is not a gap — they hold no professorship, and that is exactly the
   * case the nullable column exists for.
   */
  await db.execute(sql`
    update council_permanent_members m
       set professor_id = p.id
      from professors p
     where p.tenant_id = ${tenantId}
       and m.tenant_id = ${tenantId}
       and p.deleted_at is null
       and m.deleted_at is null
       and m.professor_id is null
       and app.fold_person(regexp_replace(m.member_name, '^دکتر[[:space:]]+', ''))
         = app.fold_person(p.first_name || ' ' || p.last_name)
  `);

  const enrolled = await db
    .select({
      id: schema.students.id,
      studentNumber: schema.students.studentNumber,
      firstName: schema.students.firstName,
      lastName: schema.students.lastName,
      degree: schema.students.degree,
      fieldOfStudy: schema.students.fieldOfStudy,
    })
    .from(schema.students)
    .where(eq(schema.students.tenantId, tenantId))
    /* Ordered, because a seed that differs between two databases is a seed
       that reproduces nothing. Without an ORDER BY the register's physical
       row order decided which student each category landed on — and on one
       database the countable proposal landed on a bachelor, leaving the
       capacity engine with nothing to count and its tests with nothing to
       assert. */
    .orderBy(schema.students.studentNumber)
    .limit(12);

  const decisionCategoryFor = (degree: string | null | undefined, finalStage: boolean) => {
    const dissertation = degree === "phd" || degree === "specialty";
    if (finalStage) return dissertation ? "dissertation_final_defense" : "thesis_final_defense";
    return dissertation ? "dissertation_proposal" : "thesis_proposal";
  };
  const statuses = ["approved", "conditional", "pending", "re_review", "rejected"];
  const titles = [
    "بررسی روش‌های یادگیری عمیق در تشخیص تصویر پزشکی",
    "طراحی سامانه‌ی توزیع‌شده برای پردازش داده‌های حجیم",
    "مدل‌سازی رفتار حرارتی در سازه‌های بتنی",
    "پایش سلامت دام با حسگرهای پوشیدنی",
    "شناسایی عوامل بیماری‌زای طیور با روش‌های مولکولی",
    "بهینه‌سازی مصرف انرژی در شبکه‌های حسگر بی‌سیم",
  ];

  const decisions = enrolled.map((student, index) => {
    const meeting = meetings[index % meetings.length];
    const sitting = sittings[index % sittings.length];
    return {
      tenantId,
      meetingId: meeting?.id ?? null,
      meetingNumber: meeting?.meetingNumber ?? "۶۷۹",
      meetingDate: sitting?.date ?? null,
      /* ASCII, like every other identifier and figure this schema stores. The
         screens localise on the way out — see `toLocaleDigits`. A column holding
         Persian digits is a column two different writers will disagree about. */
      meetingTime: "10:00",
      meetingDay: sitting?.day ?? null,
      meetingLocation: "سالن شورای دانشکده",
      studentId: student.id,
      studentNumber: student.studentNumber,
      studentName: `${student.firstName} ${student.lastName}`,
      educationLevel: student.degree,
      fieldOfStudy: student.fieldOfStudy,
      thesisTitle: titles[index % titles.length] ?? null,
      thesisCode: `TH-${1400 + index}`,
      researchType: ["fundamental", "applied", "developmental"][index % 3] ?? null,
      reportCategory: decisionCategoryFor(student.degree, index % 3 === 2),
      reviewStatus: statuses[index % statuses.length] ?? null,
      primarySupervisor: "دکتر سعید نظیفی",
      secondarySupervisor: index % 3 === 0 ? "دکتر فاطمه حسینی" : null,
      firstAdvisor: index % 4 === 0 ? "دکتر لیلا موسوی" : null,
      reviewer1: "دکتر محمدرضا اکبری",
      // A guest reviewer from another university — the reason these columns are
      // text and not foreign keys.
      reviewer2: index % 2 === 0 ? "دکتر مهدی رستمی (دانشگاه تهران)" : null,
      /* A person, not the title of the office they hold. The column is a name —
         the register prints it beside the reviewers with «(نماینده تحصیلات
         تکمیلی)» after it, so a title stored here reads as the label twice. */
      graduateStudiesRepresentative: "دکتر حمید صادقی",
      researchDeputy: "دکتر سعید نظیفی",
      /*
       * A defence date on the dossiers that have reached a defence stage.
       *
       * Spread across the coming weeks rather than all on one day, because
       * three screens read this column and each needs a different shape of it:
       * the calendar draws them on a month, the dashboard counts the ones
       * inside its horizon, and the worksheets print one at the head of a form.
       * A seed with none at all — which is what this had — leaves all three
       * looking correct and empty, which is the hardest kind of gap to notice.
       */
      ...(index % 3 === 2
        ? {
            defenseMeetingDate: isoDaysFromToday(3 + index * 6),
            defenseMeetingTime: index % 2 === 0 ? "10:00" : "14:30",
            defenseMeetingLocation: "سالن دفاع دانشکده",
          }
        : {}),
      // The paperwork, part-complete, so the checklist has something to count.
      finalProposalFile: index % 2 === 0,
      proposalDefensePermitForm: index % 3 === 0,
      researchBackground: true,
      similarityCertificate: index % 2 === 1,
      decisionText: "با انجام اصلاحات مطرح‌شده در جلسه موافقت شد.",
    };
  });

  await db.insert(schema.councilDecisions).values(decisions);

  /*
   * A countable JOINT supervision, built rather than stumbled upon.
   *
   * The cycling above scatters the five categories across twelve students, and
   * whether any of it left a supervision the capacity engine may count was
   * luck: on one database the countable proposal landed on a master's student,
   * on another on a bachelor's — which the engine correctly refuses — and the
   * screen showed an empty ledger that nothing could reproduce. So the case
   * the capacity screen exists to show — two supervisors, one student, one
   * place — is written here outright, on the first doctoral student in the
   * pool, whose degree and standing are known by construction.
   */
  const joint = enrolled[0];
  const jointMeeting = meetings[1];
  const jointSitting = sittings[1];
  if (joint && jointMeeting) {
    await db.insert(schema.councilDecisions).values({
      tenantId,
      meetingId: jointMeeting.id,
      meetingNumber: jointMeeting.meetingNumber,
      meetingDate: jointSitting?.date ?? null,
      meetingTime: "10:00",
      meetingDay: jointSitting?.day ?? null,
      meetingLocation: "سالن شورای دانشکده",
      studentId: joint.id,
      studentNumber: joint.studentNumber,
      studentName: `${joint.firstName} ${joint.lastName}`,
      educationLevel: joint.degree,
      fieldOfStudy: joint.fieldOfStudy,
      thesisTitle: titles[0] ?? null,
      thesisCode: `TH-${1400 + 90}`,
      researchType: "fundamental",
      reportCategory: decisionCategoryFor(joint.degree, false),
      reviewStatus: "conditional",
      primarySupervisor: "دکتر سعید نظیفی",
      secondarySupervisor: "دکتر فاطمه حسینی",
      reviewer1: "دکتر محمدرضا اکبری",
      graduateStudiesRepresentative: "دکتر حمید صادقی",
      researchDeputy: "دکتر سعید نظیفی",
      finalProposalFile: true,
      researchBackground: true,
      decisionText: "با انجام اصلاحات مطرح‌شده در جلسه موافقت شد.",
    });
  }

  const rulings = [
    {
      meeting: 0,
      category: "thesis_changes",
      status: "approved",
      text: "مهلت اعمال اصلاحات پایان‌نامه‌های مصوب تا پایان بهمن تمدید شد.",
    },
    {
      meeting: 2,
      category: "faculty_research",
      status: "conditional",
      text: "اجرای طرح پژوهشی دانشکده منوط به تکمیل مستندات اخلاق پژوهش است.",
      description: "مصوبه از جلسه‌ی پیشین با اصلاح بند دوم تکرار شد.",
    },
    {
      meeting: 4,
      category: "research_collaboration",
      status: "approved",
      text: "چارچوب همکاری پژوهشی بین‌گروهی برای نیم‌سال جاری تصویب شد.",
    },
  ];

  await db.insert(schema.councilRulings).values(
    rulings.map((ruling) => {
      const meeting = meetings[ruling.meeting];
      const sitting = sittings[ruling.meeting];
      return {
        tenantId,
        meetingId: meeting?.id ?? null,
        meetingNumber: meeting?.meetingNumber ?? "۶۷۹",
        meetingDate: sitting?.date ?? null,
        /* ASCII, like every other identifier and figure this schema stores. The
         screens localise on the way out — see `toLocaleDigits`. A column holding
         Persian digits is a column two different writers will disagree about. */
        meetingTime: "10:00",
        meetingDay: sitting?.day ?? null,
        meetingLocation: "سالن شورای دانشکده",
        reportCategory: ruling.category,
        reviewStatus: ruling.status,
        decisionText: ruling.text,
        decisionDescription: ruling.description ?? null,
      };
    }),
  );

  const faculty = await db
    .select({ id: schema.professors.id })
    .from(schema.professors)
    .where(eq(schema.professors.tenantId, tenantId))
    .limit(4);

  await db.insert(schema.councilAppointments).values(
    enrolled.slice(0, 4).map((student, index) => {
      const meeting = meetings[index % meetings.length];
      const sitting = sittings[index % sittings.length];
      return {
        tenantId,
        meetingId: meeting?.id ?? null,
        meetingNumber: meeting?.meetingNumber ?? "۶۷۹",
        meetingDate: sitting?.date ?? null,
        studentId: student.id,
        studentNumber: student.studentNumber,
        studentName: `${student.firstName} ${student.lastName}`,
        educationLevel: student.degree,
        fieldOfStudy: student.fieldOfStudy,
        primarySupervisorId: faculty[index % faculty.length]?.id ?? null,
        secondarySupervisorId:
          index % 2 === 0 ? (faculty[(index + 1) % faculty.length]?.id ?? null) : null,
      };
    }),
  );

  console.log(
    `council: ${meetings.length} sittings, ${decisions.length} decisions, ${rulings.length} rulings, 4 appointments`,
  );
}
