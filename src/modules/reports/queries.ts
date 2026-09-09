/**
 * Public report read-model surface.
 *
 * Keep callers insulated from the internal file layout without widening the
 * API to SQL helper fragments (`jalaliYear`, `inYear`, ...). Those helpers are
 * implementation details shared only by the domain read-model files.
 */

export {
  type CouncilBusinessReport,
  councilBusinessReport,
  type DecisionReport,
  decisionReport,
} from "./council-business.ts";
export { type MeetingReport, meetingReport } from "./meetings.ts";
export { type ProfessorReport, professorReport } from "./professors.ts";
export { type ReviewReport, reviewReport } from "./review.ts";
export {
  councilBusinessYears,
  meetingYears,
  reviewYears,
  type Tally,
  workshopYears,
} from "./shared.ts";
export { type StudentReport, studentReport } from "./students.ts";
export { type WorkshopReport, workshopReport } from "./workshops.ts";
