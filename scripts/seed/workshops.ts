import { eq } from "drizzle-orm";
import type { adminDb } from "../../src/db/admin.ts";
import * as schema from "../../src/db/schema.ts";

export async function seedWorkshops(db: ReturnType<typeof adminDb>, tenantId: string) {
  const existing = await db
    .select({ id: schema.workshops.id })
    .from(schema.workshops)
    .where(eq(schema.workshops.tenantId, tenantId))
    .limit(1);
  if (existing[0]) {
    console.log("workshops already present");
    return;
  }

  const created = await db
    .insert(schema.workshops)
    .values([
      {
        tenantId,
        title: "روش تحقیق و نگارش پیشنهاده",
        description: "کارگاه مقدماتی برای دانشجویان تحصیلات تکمیلی.",
        workshopDate: "2026-05-12",
        durationHours: "8",
        locationType: "in_person",
        venue: "سالن اجتماعات دانشکده",
        capacity: 30,
        cost: "0",
        status: "held",
      },
      {
        tenantId,
        title: "اخلاق در پژوهش زیستی",
        workshopDate: "2026-09-15",
        durationHours: "4.5",
        locationType: "online",
        venue: "سامانه‌ی آموزش مجازی",
        capacity: 60,
        cost: "1500000",
        status: "planned",
      },
    ])
    .returning({ id: schema.workshops.id, title: schema.workshops.title });

  const held = created[0];
  const planned = created[1];
  if (!held || !planned) throw new Error("workshops could not be created");

  const faculty = await db
    .select({ id: schema.professors.id })
    .from(schema.professors)
    .where(eq(schema.professors.tenantId, tenantId))
    .limit(2);

  await db.insert(schema.workshopInstructors).values([
    { tenantId, workshopId: held.id, professorId: faculty[0]?.id ?? null, role: "main" },
    {
      tenantId,
      workshopId: held.id,
      /* A guest from outside — the reason these columns exist. */
      externalName: "دکتر مهدی رستمی",
      externalAffiliation: "دانشگاه تهران",
      role: "assistant",
    },
    { tenantId, workshopId: planned.id, professorId: faculty[1]?.id ?? null, role: "main" },
  ]);

  const enrolled = await db
    .select({ id: schema.students.id })
    .from(schema.students)
    .where(eq(schema.students.tenantId, tenantId))
    .limit(8);

  const attendance = ["attended", "attended", "attended", "absent", "registered"];
  const participants = await db
    .insert(schema.workshopParticipants)
    .values([
      ...enrolled.slice(0, 5).map((student, index) => ({
        tenantId,
        workshopId: held.id,
        studentId: student.id,
        registrationDate: "2026-05-01",
        attendanceStatus: attendance[index % attendance.length] ?? "registered",
        paymentStatus: "free",
      })),
      {
        tenantId,
        workshopId: held.id,
        /* Somebody who is not on the student register at all. */
        externalName: "زهرا فرهادی",
        externalAffiliation: "پژوهشکده‌ی بیوتکنولوژی",
        externalMobile: "09121234567",
        registrationDate: "2026-05-02",
        attendanceStatus: "attended",
        paymentStatus: "paid",
      },
      ...enrolled.slice(5, 8).map((student) => ({
        tenantId,
        workshopId: planned.id,
        studentId: student.id,
        registrationDate: "2026-08-20",
        attendanceStatus: "registered",
        paymentStatus: "pending",
      })),
    ])
    .returning({
      id: schema.workshopParticipants.id,
      workshopId: schema.workshopParticipants.workshopId,
      attendanceStatus: schema.workshopParticipants.attendanceStatus,
    });

  /* Certificates only for those who actually attended. */
  const attended = participants.filter(
    (participant) =>
      participant.workshopId === held.id && participant.attendanceStatus === "attended",
  );

  await db.insert(schema.workshopCertificates).values(
    attended.map((participant, index) => ({
      tenantId,
      workshopId: held.id,
      participantId: participant.id,
      certificateNumber: `W1404-${String(index + 1).padStart(3, "0")}`,
      issueDate: "2026-05-20",
      /*
       * Deterministic here because the seed must be reproducible; the action
       * that issues one in the running application mints a random code, which
       * is the whole of what makes a certificate checkable.
       */
      verificationCode: `SEED-${String(index + 1).padStart(4, "0")}-${held.id.slice(0, 8)}`,
    })),
  );

  console.log(
    `workshops: 2 workshops, ${participants.length} participants, 3 instructors, ${attended.length} certificates`,
  );
}
