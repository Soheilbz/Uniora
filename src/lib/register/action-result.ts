/**
 * What a register's write actions report back.
 *
 * Here rather than beside one module's actions, because the toolbar takes a
 * delete action as a prop and every register has one — the students', the
 * council's sittings, its rulings. A shared shape is what lets one `RegisterView`
 * serve all of them without importing any particular module's server code into
 * the browser bundle.
 */
export interface ActionResult {
  ok: boolean;
  /** Catalogue keys, per field, so the message is translated where it is shown. */
  errors?: Record<string, string>;
  /** A catalogue key for a failure that belongs to no single field. */
  message?: string;
  /**
   * What was submitted, returned so a refused save does not lose it.
   *
   * React resets an uncontrolled form once a form action completes — so without
   * this, a validation error empties every box on the record and the operator
   * retypes fifty fields to fix one. The form re-applies these as its defaults.
   *
   * Raw strings, exactly as they were posted: the point is to give back what the
   * person wrote, including the part that was rejected, so they can see and
   * correct it rather than guess at what they had.
   */
  values?: Record<string, string>;
}
