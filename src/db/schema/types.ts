import type { calendarEntries } from "./calendar.ts";
import type { professorCapacities } from "./capacity.ts";
import type { tenants } from "./core.ts";
import type {
  councilAppointments,
  councilDecisions,
  councilMeetings,
  councilRulings,
} from "./council.ts";
import type { institutions, professors, students } from "./registry.ts";
import type {
  workshopCertificates,
  workshopInstructors,
  workshopParticipants,
  workshops,
} from "./workshops.ts";

export type Tenant = typeof tenants.$inferSelect;
export type Institution = typeof institutions.$inferSelect;
export type CalendarEntry = typeof calendarEntries.$inferSelect;
export type Student = typeof students.$inferSelect;
export type Professor = typeof professors.$inferSelect;
export type CouncilMeeting = typeof councilMeetings.$inferSelect;
export type CouncilDecision = typeof councilDecisions.$inferSelect;
export type CouncilRuling = typeof councilRulings.$inferSelect;
export type CouncilAppointment = typeof councilAppointments.$inferSelect;
export type ProfessorCapacity = typeof professorCapacities.$inferSelect;
export type Workshop = typeof workshops.$inferSelect;
export type WorkshopParticipant = typeof workshopParticipants.$inferSelect;
export type WorkshopInstructor = typeof workshopInstructors.$inferSelect;
export type WorkshopCertificate = typeof workshopCertificates.$inferSelect;
