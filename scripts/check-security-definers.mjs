import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const roots = ["drizzle", "db/sql"];
const failures = [];
const definerFunctions = [];
const revokeByFunction = new Set();

for (const file of roots.flatMap(walkSql)) {
  const sql = readFileSync(file, "utf8");

  for (const match of sql.matchAll(
    /\bREVOKE\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE)\s+ON\s+FUNCTION\s+([A-Za-z0-9_".]+)\s*\([^;]*?\)\s+FROM\s+PUBLIC\b/gis,
  )) {
    revokeByFunction.add(normalizeName(match[1]));
  }

  for (const match of sql.matchAll(/\bGRANT\s+[^;]*?\s+TO\s+PUBLIC\b/gi)) {
    const statement = sql.slice(match.index, sql.indexOf(";", match.index) + 1 || undefined);
    failures.push(`${file}: grants privileges to PUBLIC: ${oneLine(statement)}`);
  }

  const starts = [
    ...sql.matchAll(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([A-Za-z0-9_".]+)\s*\(/gis),
  ];
  for (let index = 0; index < starts.length; index += 1) {
    const match = starts[index];
    const end = starts[index + 1]?.index ?? sql.length;
    const segment = sql.slice(match.index, end);
    if (!/\bSECURITY\s+DEFINER\b/i.test(segment)) continue;
    const name = normalizeName(match[1]);
    definerFunctions.push({ file, name, line: lineNumber(sql, match.index) });
  }
}

for (const fn of definerFunctions) {
  if (!revokeByFunction.has(fn.name)) {
    failures.push(
      `${fn.file}:${fn.line}: SECURITY DEFINER function ${fn.name} lacks an explicit REVOKE ... FROM PUBLIC`,
    );
  }
}

if (definerFunctions.length === 0) {
  failures.push(
    "no SECURITY DEFINER functions were discovered; parser/source layout may have drifted",
  );
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`security-definer contract error: ${failure}`);
  process.exit(1);
}

console.log(
  `security-definer contracts: ok (${definerFunctions.length} SECURITY DEFINER functions, explicit PUBLIC revocation present)`,
);

function walkSql(root) {
  const output = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) output.push(...walkSql(path));
    else if (extname(path).toLowerCase() === ".sql") output.push(relative(".", path));
  }
  return output;
}

function normalizeName(value) {
  return value.replaceAll('"', "").toLowerCase();
}

function lineNumber(text, index) {
  return text.slice(0, index).split("\n").length;
}

function oneLine(text) {
  return text.replace(/\s+/g, " ").trim().slice(0, 220);
}
