import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

/* pg_stat_statements is optional on managed PostgreSQL. Keep its archive entry
 * out of the restore TOC when the target provider has not installed it; the
 * migration path already treats this extension as optional and diagnostics
 * report that state explicitly. */
export function prepareRestoreList(binary, archive, listPath) {
  const listed = spawnSync(binary, ["--list", archive], { encoding: "utf8" });
  if (listed.status !== 0) throw new Error("backup is not a readable PostgreSQL custom archive");
  const filtered = listed.stdout
    .split(/\r?\n/)
    .filter((line) => !/\b(?:EXTENSION|COMMENT)\b.*\bpg_stat_statements\b/.test(line))
    .join("\n");
  writeFileSync(listPath, filtered, { encoding: "utf8", mode: 0o600, flag: "wx" });
}
