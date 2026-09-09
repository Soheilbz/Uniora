import { describe, expect, it } from "vitest";
import { foldDigits, isValidNationalId, studentSchema } from "./validation.ts";

describe("foldDigits", () => {
  it("folds Persian and Arabic-Indic digits to ASCII", () => {
    expect(foldDigits("۴۰۰۱۲۳۴۵")).toBe("40012345");
    expect(foldDigits("٤٠٠١٢٣٤٥")).toBe("40012345");
    expect(foldDigits("40012345")).toBe("40012345");
  });

  it("folds digits inside text and leaves the text alone", () => {
    expect(foldDigits("پلاک ۱۲ واحد ۳")).toBe("پلاک 12 واحد 3");
  });

  it("leaves a string with no digits untouched", () => {
    expect(foldDigits("مریم رضایی")).toBe("مریم رضایی");
  });
});

describe("isValidNationalId", () => {
  it("accepts numbers whose check digit is right", () => {
    // Known-good numbers, each verified against the published algorithm.
    expect(isValidNationalId("0499370899")).toBe(true);
    expect(isValidNationalId("0790419904")).toBe(true);
    expect(isValidNationalId("0084575948")).toBe(true);
  });

  it("rejects a transposition, which is the mistake it exists to catch", () => {
    /*
     * The reason this check is worth having. Two adjacent digits swapped
     * produces a number that is the right length, looks entirely ordinary, and
     * files without complaint — then fails months later when the ministry
     * cannot match the student.
     */
    expect(isValidNationalId("0499370899")).toBe(true);
    expect(isValidNationalId("0499378099")).toBe(false);
  });

  it("rejects a repeated digit, which passes the arithmetic", () => {
    // «0000000000» and «1111111111» satisfy the checksum by accident and are
    // not real numbers — the separate rule is not redundant.
    for (const digit of "0123456789") {
      expect(isValidNationalId(digit.repeat(10))).toBe(false);
    }
  });

  it("rejects anything that is not ten digits", () => {
    expect(isValidNationalId("")).toBe(false);
    expect(isValidNationalId("049937089")).toBe(false);
    expect(isValidNationalId("04993708999")).toBe(false);
    expect(isValidNationalId("04993708a9")).toBe(false);
  });

  it("accepts a valid number typed in Persian digits", () => {
    expect(isValidNationalId("۰۴۹۹۳۷۰۸۹۹")).toBe(true);
  });
});

describe("studentSchema", () => {
  /** Every field the form posts, so a parse exercises the whole record. */
  const complete = (overrides: Record<string, string> = {}) => ({
    studentNumber: "40012345",
    firstName: "مریم",
    lastName: "رضایی",
    status: "enrolled",
    ...Object.fromEntries(
      [
        "nationalId",
        "idNumber",
        "fatherName",
        "gender",
        "maritalStatus",
        "nationality",
        "birthDate",
        "birthYear",
        "birthPlace",
        "passportNumber",
        "militaryStatusType",
        "militaryStatus",
        "degree",
        "admissionDate",
        "sourceUniversity",
        "faculty",
        "department",
        "fieldOfStudy",
        "primarySupervisorId",
        "secondarySupervisorId",
        "thirdSupervisorId",
        "advisorId",
        "admissionType",
        "fundingType",
        "entryMethod",
        "quota",
        "phone",
        "email",
        "previousUniversity",
        "previousStudentNumber",
        "previousField",
        "previousGpa",
        "previousGraduationDate",
        "overallGpa",
        "diplomaType",
        "diplomaWrittenGpa",
        "diplomaGpa",
        "completedUnits",
        "currentSemesterUnits",
        "semestersCount",
        "militaryLetterStatus",
      ].map((key) => [key, ""]),
    ),
    ...overrides,
  });

  it("accepts a record with only its required fields", () => {
    const parsed = studentSchema.safeParse(complete());
    expect(parsed.success).toBe(true);
  });

  it("stores an untouched box as null, never as an empty string", () => {
    /*
     * A student whose father's name is `""` is not the same as one whose
     * father's name is unrecorded: it sorts differently, `IS NULL` does not
     * find it, and a report counting recorded values counts it.
     */
    const parsed = studentSchema.parse(complete());
    expect(parsed.fatherName).toBeNull();
    expect(parsed.birthYear).toBeNull();
    expect(parsed.birthDate).toBeNull();
  });

  it("refuses a record with no student number", () => {
    const parsed = studentSchema.safeParse(complete({ studentNumber: "   " }));
    expect(parsed.success).toBe(false);
  });

  it("folds a student number typed in Persian digits before storing it", () => {
    // Two clerks on two keyboards must produce the same stored number, or the
    // register holds the same person twice under numbers that look identical.
    const parsed = studentSchema.parse(complete({ studentNumber: "۴۰۰۱۲۳۴۵" }));
    expect(parsed.studentNumber).toBe("40012345");
  });

  it("accepts a new lookup value and normalizes Persian letter variants", () => {
    const parsed = studentSchema.parse(complete({ faculty: "دانشگاه كاشان" }));
    expect(parsed.faculty).toBe("دانشگاه کاشان");
  });

  it("refuses a national id whose check digit is wrong", () => {
    expect(studentSchema.safeParse(complete({ nationalId: "1234567890" })).success).toBe(false);
    expect(studentSchema.safeParse(complete({ nationalId: "0499370899" })).success).toBe(true);
  });

  it("keeps a number in range and refuses one outside it", () => {
    // Jalali birth years: 1280–1500. A Gregorian year typed by habit is the
    // realistic mistake, and it is out of range by centuries.
    expect(studentSchema.safeParse(complete({ birthYear: "1375" })).success).toBe(true);
    expect(studentSchema.safeParse(complete({ birthYear: "1996" })).success).toBe(false);
    expect(studentSchema.safeParse(complete({ birthYear: "abc" })).success).toBe(false);
  });

  it("keeps a GPA on the 0–20 scale", () => {
    expect(studentSchema.safeParse(complete({ overallGpa: "17.85" })).success).toBe(true);
    expect(studentSchema.safeParse(complete({ overallGpa: "20" })).success).toBe(true);
    // A GPA entered on a 4-point scale is in range and wrong; one entered as a
    // percentage is out of range and catchable.
    expect(studentSchema.safeParse(complete({ overallGpa: "85" })).success).toBe(false);
  });

  it("parses a number to a number, not to a string", () => {
    const parsed = studentSchema.parse(complete({ completedUnits: "۲۴" }));
    expect(parsed.completedUnits).toBe(24);
  });

  it("refuses a date that is not a real ISO calendar date", () => {
    expect(studentSchema.safeParse(complete({ birthDate: "1996-05-05" })).success).toBe(true);
    expect(studentSchema.safeParse(complete({ birthDate: "1375/02/15" })).success).toBe(false);
    expect(studentSchema.safeParse(complete({ birthDate: "2026-02-29" })).success).toBe(false);
    expect(studentSchema.safeParse(complete({ birthDate: "2024-02-29" })).success).toBe(true);
    expect(studentSchema.safeParse(complete({ birthDate: "2026-13-01" })).success).toBe(false);
  });

  it("enforces the declared numeric scale", () => {
    expect(studentSchema.safeParse(complete({ overallGpa: "17.85" })).success).toBe(true);
    expect(studentSchema.safeParse(complete({ overallGpa: "17.851" })).success).toBe(false);
    expect(studentSchema.safeParse(complete({ completedUnits: "24.5" })).success).toBe(false);
  });

  it("rejects a malformed UUID reference before it reaches PostgreSQL", () => {
    expect(studentSchema.safeParse(complete({ primarySupervisorId: "not-a-uuid" })).success).toBe(
      false,
    );
  });

  it("refuses an address that is not one", () => {
    expect(studentSchema.safeParse(complete({ email: "s@univ.local" })).success).toBe(true);
    expect(studentSchema.safeParse(complete({ email: "not an address" })).success).toBe(false);
  });

  it("refuses letters in a digits-only field", () => {
    expect(studentSchema.safeParse(complete({ studentNumber: "4001234x" })).success).toBe(false);
  });

  it("refuses a value longer than its column", () => {
    expect(studentSchema.safeParse(complete({ firstName: "م".repeat(201) })).success).toBe(false);
    expect(studentSchema.safeParse(complete({ firstName: "م".repeat(200) })).success).toBe(true);
  });
});
