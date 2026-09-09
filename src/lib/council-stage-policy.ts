import { type SQL, sql } from "drizzle-orm";

/** Outcomes that make a council decision operative for analytical reports. */
export const VALID_DECISION_STATUSES = ["approved", "conditional"] as const;

/** Student proposal decisions stored by the Web workflow. */
export const PROPOSAL_DECISION_CATEGORIES = ["thesis_proposal", "dissertation_proposal"] as const;

/** Final-defence decisions that release an active supervision place. */
export const FINAL_DEFENSE_DECISION_CATEGORIES = [
  "thesis_final_defense",
  "dissertation_final_defense",
] as const;

export const STUDENT_DECISION_CATEGORIES = [
  ...PROPOSAL_DECISION_CATEGORIES,
  ...FINAL_DEFENSE_DECISION_CATEGORIES,
] as const;

/** Build a parameterised SQL IN list for the policy constants. */
export function sqlInList(values: readonly string[]): SQL {
  return sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );
}
