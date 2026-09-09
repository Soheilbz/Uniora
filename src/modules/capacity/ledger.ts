import {
  FINAL_DEFENSE_DECISION_CATEGORIES,
  VALID_DECISION_STATUSES,
} from "@/lib/council-stage-policy.ts";
import { type CapacityTable, capacityTableForDegree } from "./regulation.ts";

/** A structured supervision appointment recorded by the council. */
export interface LedgerAppointment {
  id: string;
  studentId: string | null;
  meetingDate: string | null;
  meetingNumber: string | null;
  primarySupervisorId: string | null;
  secondarySupervisorId: string | null;
  thirdSupervisorId: string | null;
}

/** A final-defence decision, used only to determine whether supervision ended. */
export interface LedgerDecision {
  id: string;
  studentId: string | null;
  meetingDate: string | null;
  meetingNumber: string | null;
  reportCategory: string | null;
  reviewStatus: string | null;
}

export interface LedgerStudent {
  id: string;
  studentNumber: string | null;
  firstName: string | null;
  lastName: string | null;
  degree: string | null;
  status: string | null;
  nationality: string | null;
  department: string | null;
  entryMethod: string | null;
  primarySupervisorId: string | null;
  secondarySupervisorId: string | null;
  thirdSupervisorId: string | null;
}

export const SUPERVISOR_SEATS = ["primary", "secondary", "third"] as const;
export type SupervisorSeatName = (typeof SUPERVISOR_SEATS)[number];

const APPOINTMENT_SEAT: Readonly<Record<SupervisorSeatName, keyof LedgerAppointment>> = {
  primary: "primarySupervisorId",
  secondary: "secondarySupervisorId",
  third: "thirdSupervisorId",
};
const REGISTER_SEAT: Readonly<Record<SupervisorSeatName, keyof LedgerStudent>> = {
  primary: "primarySupervisorId",
  secondary: "secondarySupervisorId",
  third: "thirdSupervisorId",
};
const DEFENCE_CATEGORIES = new Set<string>(FINAL_DEFENSE_DECISION_CATEGORIES);
const OPERATIVE = new Set<string>(VALID_DECISION_STATUSES);
const RELEASING_STATUS = new Set(["graduated", "withdrawn", "dismissed", "transferred"]);

function str(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

export interface SupervisorSeat {
  seat: SupervisorSeatName;
  name: string;
  professorId: string | null;
}

export interface CountableParsa {
  studentId: string;
  student: LedgerStudent;
  /** Latest structured council appointment supporting this supervision. */
  appointment: LedgerAppointment | null;
  table: CapacityTable;
  seats: SupervisorSeat[];
  international: boolean;
  /** True when the student register has an assignment but no council appointment. */
  appointmentOnly?: boolean;
}

export interface LedgerResult {
  countable: CountableParsa[];
  stats: {
    appointmentEvents: number;
    closedByDefence: number;
    closedByStatus: number;
    studentMissing: number;
    noCapacityTable: number;
    noSupervisorSeat: number;
  };
}

export function registeredSeats(student: LedgerStudent): (string | null)[] {
  return SUPERVISOR_SEATS.map((seat) => {
    const value = str(student[REGISTER_SEAT[seat]]);
    return value === "" ? null : value;
  });
}

export function seatsOfAppointment(
  appointment: LedgerAppointment,
  names: ReadonlyMap<string, { name: string }>,
): SupervisorSeat[] {
  return SUPERVISOR_SEATS.flatMap((seat) => {
    const value = appointment[APPOINTMENT_SEAT[seat]];
    const professorId = typeof value === "string" && value.trim() ? value : null;
    if (!professorId) return [];
    return [{ seat, professorId, name: names.get(professorId)?.name ?? professorId }];
  });
}

function eventOrder(
  left: { meetingDate: string | null; meetingNumber: string | null },
  right: { meetingDate: string | null; meetingNumber: string | null },
): number {
  const byDate = str(left.meetingDate).localeCompare(str(right.meetingDate));
  if (byDate !== 0) return byDate;
  return Number(left.meetingNumber ?? 0) - Number(right.meetingNumber ?? 0);
}

/**
 * Computes every currently occupied supervision place from structured council
 * appointments, releasing it after an operative final-defence decision or a
 * terminal student status. The latest appointment per student is authoritative.
 */
export function openParsas(
  appointments: readonly LedgerAppointment[],
  decisions: readonly LedgerDecision[],
  students: readonly LedgerStudent[],
  names: ReadonlyMap<string, { name: string }>,
  tableForDegree: (degree: unknown) => CapacityTable | null = capacityTableForDegree,
): LedgerResult {
  const byId = new Map(students.map((student) => [student.id, student]));
  const stats = {
    appointmentEvents: appointments.length,
    closedByDefence: 0,
    closedByStatus: 0,
    studentMissing: 0,
    noCapacityTable: 0,
    noSupervisorSeat: 0,
  };

  const latestAppointment = new Map<string, LedgerAppointment>();
  for (const appointment of [...appointments].sort(eventOrder)) {
    const studentId = str(appointment.studentId);
    if (studentId) latestAppointment.set(studentId, appointment);
  }

  const defended = new Set<string>();
  for (const decision of decisions) {
    const studentId = str(decision.studentId);
    if (
      studentId &&
      DEFENCE_CATEGORIES.has(str(decision.reportCategory)) &&
      OPERATIVE.has(str(decision.reviewStatus))
    ) {
      defended.add(studentId);
    }
  }

  const countable: CountableParsa[] = [];
  for (const [studentId, appointment] of latestAppointment) {
    if (defended.has(studentId)) {
      stats.closedByDefence += 1;
      continue;
    }
    const student = byId.get(studentId);
    if (!student) {
      stats.studentMissing += 1;
      continue;
    }
    if (RELEASING_STATUS.has(str(student.status))) {
      stats.closedByStatus += 1;
      continue;
    }
    const table = tableForDegree(student.degree);
    if (!table) {
      stats.noCapacityTable += 1;
      continue;
    }
    const seats = seatsOfAppointment(appointment, names);
    if (seats.length === 0) {
      stats.noSupervisorSeat += 1;
      continue;
    }
    const nationality = str(student.nationality);
    countable.push({
      studentId,
      student,
      appointment,
      table,
      seats,
      international: nationality !== "" && nationality !== "iranian",
    });
  }

  return { countable, stats };
}
