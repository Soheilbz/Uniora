import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  attachments,
  councilDecisions,
  portalLinks,
  professorCapacities,
  professors,
  studentSupervisionAssignments,
  students,
  tasks,
  user,
  workshopCertificates,
  workshopInstructors,
  workshopParticipants,
  workshops,
} from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";
import type { Viewer } from "@/lib/capabilities.ts";

export type PortalSubjectKind = "student" | "professor";

export async function readPortalSubjectKinds(
  viewer: Viewer,
): Promise<ReadonlySet<PortalSubjectKind>> {
  const rows = await readOnly(viewer.tenantId, (tx) =>
    tx
      .select({ subjectType: portalLinks.subjectType })
      .from(portalLinks)
      .where(
        and(
          eq(portalLinks.userId, viewer.userId),
          eq(portalLinks.status, "active"),
          isNull(portalLinks.deletedAt),
        ),
      ),
  );
  return new Set(
    rows
      .map((row) => row.subjectType)
      .filter((value): value is PortalSubjectKind => value === "student" || value === "professor"),
  );
}

export async function hasActivePortalLink(viewer: Viewer): Promise<boolean> {
  return (await readPortalSubjectKinds(viewer)).size > 0;
}

async function subjectLink(viewer: Viewer, kind: PortalSubjectKind) {
  const [row] = await readOnly(viewer.tenantId, (tx) =>
    tx
      .select({ studentId: portalLinks.studentId, professorId: portalLinks.professorId })
      .from(portalLinks)
      .where(
        and(
          eq(portalLinks.userId, viewer.userId),
          eq(portalLinks.subjectType, kind),
          eq(portalLinks.status, "active"),
          isNull(portalLinks.deletedAt),
        ),
      )
      .limit(1),
  );
  return row ?? null;
}

export async function readStudentPortal(viewer: Viewer) {
  const link = await subjectLink(viewer, "student");
  if (!link?.studentId) return null;
  const studentId = link.studentId;
  return readOnly(viewer.tenantId, async (tx) => {
    const [student] = await tx
      .select({
        id: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
        studentNumber: students.studentNumber,
        degree: students.degree,
        status: students.status,
        faculty: students.faculty,
        department: students.department,
        fieldOfStudy: students.fieldOfStudy,
        admissionDate: students.admissionDate,
        email: students.email,
        phone: students.phone,
        overallGpa: students.overallGpa,
        completedUnits: students.completedUnits,
        semestersCount: students.semestersCount,
      })
      .from(students)
      .where(and(eq(students.id, studentId), isNull(students.deletedAt)))
      .limit(1);
    if (!student) return null;

    const supervision = await tx
      .select({
        role: studentSupervisionAssignments.role,
        professorName: studentSupervisionAssignments.professorNameSnapshot,
        department: studentSupervisionAssignments.departmentNameSnapshot,
        validFrom: studentSupervisionAssignments.validFrom,
        validTo: studentSupervisionAssignments.validTo,
        status: studentSupervisionAssignments.status,
      })
      .from(studentSupervisionAssignments)
      .where(eq(studentSupervisionAssignments.studentId, studentId))
      .orderBy(desc(studentSupervisionAssignments.validFrom));

    const decisions = await tx
      .select({
        id: councilDecisions.id,
        meetingDate: councilDecisions.meetingDate,
        reportCategory: councilDecisions.reportCategory,
        thesisTitle: councilDecisions.thesisTitle,
        reviewStatus: councilDecisions.reviewStatus,
        decisionText: councilDecisions.decisionText,
      })
      .from(councilDecisions)
      .where(
        and(
          eq(councilDecisions.studentId, studentId),
          eq(councilDecisions.workflowState, "finalized"),
          isNull(councilDecisions.deletedAt),
        ),
      )
      .orderBy(desc(councilDecisions.meetingDate), desc(councilDecisions.createdAt))
      .limit(50);

    const workshopHistory = await tx
      .select({
        workshopId: workshops.id,
        title: workshops.title,
        workshopDate: workshops.workshopDate,
        attendanceStatus: workshopParticipants.attendanceStatus,
        certificateNumber: workshopCertificates.certificateNumber,
        verificationCode: workshopCertificates.verificationCode,
      })
      .from(workshopParticipants)
      .innerJoin(
        workshops,
        and(eq(workshops.id, workshopParticipants.workshopId), isNull(workshops.deletedAt)),
      )
      .leftJoin(
        workshopCertificates,
        and(
          eq(workshopCertificates.participantId, workshopParticipants.id),
          isNull(workshopCertificates.deletedAt),
        ),
      )
      .where(
        and(eq(workshopParticipants.studentId, studentId), isNull(workshopParticipants.deletedAt)),
      )
      .orderBy(desc(workshops.workshopDate), desc(workshops.createdAt))
      .limit(50);

    const documents = await tx
      .select({
        id: attachments.id,
        filename: attachments.filename,
        mimeType: attachments.mimeType,
        sizeBytes: attachments.sizeBytes,
        createdAt: attachments.createdAt,
      })
      .from(attachments)
      .where(
        and(
          eq(attachments.entityType, "student"),
          eq(attachments.entityId, studentId),
          eq(attachments.status, "available"),
          isNull(attachments.deletedAt),
        ),
      )
      .orderBy(desc(attachments.createdAt))
      .limit(50);

    return { student, supervision, decisions, workshopHistory, documents };
  });
}

export async function readProfessorPortal(viewer: Viewer) {
  const link = await subjectLink(viewer, "professor");
  if (!link?.professorId) return null;
  const professorId = link.professorId;
  return readOnly(viewer.tenantId, async (tx) => {
    const [professor] = await tx
      .select({
        id: professors.id,
        professorCode: professors.professorCode,
        firstName: professors.firstName,
        lastName: professors.lastName,
        academicRank: professors.academicRank,
        specialization: professors.specialization,
        department: professors.department,
        faculty: professors.faculty,
        email: professors.email,
        phone: professors.phone,
        employmentStatus: professors.employmentStatus,
      })
      .from(professors)
      .where(and(eq(professors.id, professorId), isNull(professors.deletedAt)))
      .limit(1);
    if (!professor) return null;

    const supervisions = await tx
      .select({
        id: studentSupervisionAssignments.id,
        role: studentSupervisionAssignments.role,
        validFrom: studentSupervisionAssignments.validFrom,
        studentId: students.id,
        studentNumber: students.studentNumber,
        studentName: sql<string>`btrim(coalesce(${students.firstName},'') || ' ' || coalesce(${students.lastName},''))`,
        degree: students.degree,
        status: students.status,
      })
      .from(studentSupervisionAssignments)
      .innerJoin(
        students,
        and(eq(students.id, studentSupervisionAssignments.studentId), isNull(students.deletedAt)),
      )
      .where(
        and(
          eq(studentSupervisionAssignments.professorId, professorId),
          eq(studentSupervisionAssignments.status, "active"),
          isNull(studentSupervisionAssignments.validTo),
        ),
      )
      .orderBy(desc(studentSupervisionAssignments.validFrom));

    const capacities = await tx
      .select({
        year: professorCapacities.year,
        doctorateConcurrentTotal: professorCapacities.doctorateConcurrentTotal,
        mastersConcurrentTotal: professorCapacities.mastersConcurrentTotal,
        doctorateAnnualTotal: professorCapacities.doctorateAnnualTotal,
        mastersAnnualTotal: professorCapacities.mastersAnnualTotal,
      })
      .from(professorCapacities)
      .where(
        and(
          eq(professorCapacities.professorId, professorId),
          isNull(professorCapacities.deletedAt),
        ),
      )
      .orderBy(desc(professorCapacities.year))
      .limit(3);

    const workshopHistory = await tx
      .select({
        id: workshops.id,
        title: workshops.title,
        workshopDate: workshops.workshopDate,
        role: workshopInstructors.role,
      })
      .from(workshopInstructors)
      .innerJoin(
        workshops,
        and(eq(workshops.id, workshopInstructors.workshopId), isNull(workshops.deletedAt)),
      )
      .where(
        and(
          eq(workshopInstructors.professorId, professorId),
          isNull(workshopInstructors.deletedAt),
        ),
      )
      .orderBy(desc(workshops.workshopDate), desc(workshops.createdAt))
      .limit(50);

    const assignedTasks = await tx
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
        dueAt: tasks.dueAt,
        entityType: tasks.entityType,
        entityId: tasks.entityId,
      })
      .from(tasks)
      .where(and(eq(tasks.assignedTo, viewer.userId), isNull(tasks.deletedAt)))
      .orderBy(desc(tasks.priority), desc(tasks.createdAt))
      .limit(50);

    const documents = await tx
      .select({
        id: attachments.id,
        filename: attachments.filename,
        mimeType: attachments.mimeType,
        sizeBytes: attachments.sizeBytes,
        createdAt: attachments.createdAt,
      })
      .from(attachments)
      .where(
        and(
          eq(attachments.entityType, "professor"),
          eq(attachments.entityId, professorId),
          eq(attachments.status, "available"),
          isNull(attachments.deletedAt),
        ),
      )
      .orderBy(desc(attachments.createdAt))
      .limit(50);

    return { professor, supervisions, capacities, workshopHistory, assignedTasks, documents };
  });
}

export async function readPortalAdministration(tenantId: string) {
  return readOnly(tenantId, async (tx) => {
    /*
     * Keep these reads sequential inside one tenant transaction. The node-postgres
     * client backing a transaction is a single connection; firing several
     * unrelated statements concurrently only creates local queuing and makes
     * cancellation/error ordering harder to reason about.
     */
    const links = await tx
      .select({
        id: portalLinks.id,
        version: portalLinks.version,
        userId: portalLinks.userId,
        userName: user.name,
        username: user.displayUsername,
        subjectType: portalLinks.subjectType,
        studentId: portalLinks.studentId,
        professorId: portalLinks.professorId,
        status: portalLinks.status,
      })
      .from(portalLinks)
      .innerJoin(user, eq(user.id, portalLinks.userId))
      .where(isNull(portalLinks.deletedAt))
      .orderBy(user.name);
    const users = await tx
      .select({ id: user.id, name: user.name, username: user.displayUsername })
      .from(user)
      .where(and(eq(user.tenantId, tenantId), isNull(user.suspendedAt)))
      .orderBy(user.name)
      .limit(500);
    const studentRows = await tx
      .select({
        id: students.id,
        studentNumber: students.studentNumber,
        firstName: students.firstName,
        lastName: students.lastName,
      })
      .from(students)
      .where(isNull(students.deletedAt))
      .orderBy(students.lastName, students.firstName)
      .limit(500);
    const professorRows = await tx
      .select({
        id: professors.id,
        professorCode: professors.professorCode,
        firstName: professors.firstName,
        lastName: professors.lastName,
      })
      .from(professors)
      .where(isNull(professors.deletedAt))
      .orderBy(professors.lastName, professors.firstName)
      .limit(500);
    return { links, users, students: studentRows, professors: professorRows };
  });
}

/** Whether an attachment belongs to one of the domain records linked to this portal identity. */
export async function canAccessPortalAttachment(
  viewer: Viewer,
  attachmentId: string,
): Promise<{ objectKey: string } | null> {
  const links = await readOnly(viewer.tenantId, (tx) =>
    tx
      .select({ studentId: portalLinks.studentId, professorId: portalLinks.professorId })
      .from(portalLinks)
      .where(
        and(
          eq(portalLinks.userId, viewer.userId),
          eq(portalLinks.status, "active"),
          isNull(portalLinks.deletedAt),
        ),
      ),
  );
  if (links.length === 0) return null;
  return readOnly(viewer.tenantId, async (tx) => {
    const [row] = await tx
      .select({
        entityType: attachments.entityType,
        entityId: attachments.entityId,
        objectKey: attachments.objectKey,
        status: attachments.status,
      })
      .from(attachments)
      .where(
        and(
          eq(attachments.id, attachmentId),
          eq(attachments.status, "available"),
          isNull(attachments.deletedAt),
        ),
      )
      .limit(1);
    if (!row) return null;
    const allowed = links.some(
      (link) =>
        (row.entityType === "student" && link.studentId === row.entityId) ||
        (row.entityType === "professor" && link.professorId === row.entityId),
    );
    return allowed ? { objectKey: row.objectKey } : null;
  });
}
