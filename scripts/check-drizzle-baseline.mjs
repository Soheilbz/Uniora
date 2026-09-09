import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const meta = join(root, "drizzle", "meta");
const generationReady = process.argv.includes("--generation-ready");
const journal = JSON.parse(readFileSync(join(meta, "_journal.json"), "utf8"));
const entries = Array.isArray(journal.entries) ? journal.entries : [];
if (entries.length === 0) throw new Error("Drizzle migration journal is empty");
const latest = entries.reduce((a, b) => (Number(a.idx) > Number(b.idx) ? a : b));
const failures = [];

const snapshots = readdirSync(meta)
  .map((name) => name.match(/^(\d{4})_snapshot\.json$/)?.[1])
  .filter(Boolean)
  .map(Number)
  .sort((a, b) => a - b);
const latestSnapshotIdx = snapshots.at(-1) ?? -1;
const latestSnapshotPath =
  latestSnapshotIdx >= 0
    ? join(meta, `${String(latestSnapshotIdx).padStart(4, "0")}_snapshot.json`)
    : null;

const schemaDir = join(root, "src", "db", "schema");
const schemaFiles = readdirSync(schemaDir)
  .filter((name) => name.endsWith(".ts"))
  .sort();
const schemaTables = new Set();
for (const file of schemaFiles) {
  const source = readFileSync(join(schemaDir, file), "utf8");
  for (const match of source.matchAll(/pgTable\(\s*["']([^"']+)["']/g)) schemaTables.add(match[1]);
}

if (latestSnapshotIdx === Number(latest.idx)) {
  verifySnapshot(latestSnapshotPath, schemaTables, failures);
  if (failures.length === 0) {
    console.log(`Drizzle generation baseline is current at ${latest.idx}:${latest.tag}.`);
  }
} else if (generationReady) {
  failures.push(
    `latest journal entry ${latest.idx}:${latest.tag} has no generated ${String(latest.idx).padStart(4, "0")}_snapshot.json; ` +
      "run release:prepare and commit the metadata-only baseline before generating another migration",
  );
} else {
  verifyManualGap({ latest, latestSnapshotIdx, schemaFiles, schemaTables, entries, failures });
  if (failures.length === 0) {
    console.log(
      `Drizzle deployment metadata contract is current through ${latest.idx}:${latest.tag}; ` +
        `generated snapshot remains at ${latestSnapshotIdx}. Future migration generation is blocked until release:prepare reconciles a metadata-only snapshot.`,
    );
  }
}

if (failures.length) {
  console.error(`Drizzle metadata baseline is not current:\n- ${failures.join("\n- ")}`);
  if (generationReady) {
    console.error(
      "Run `pnpm release:prepare` on the certification host, review the generated metadata-only baseline, and commit it before generating future migrations.",
    );
  }
  process.exit(1);
}

function verifySnapshot(snapshotPath, expectedTables, out) {
  if (!snapshotPath || !existsSync(snapshotPath)) {
    out.push("generated Drizzle snapshot is missing");
    return;
  }
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
  const snapshotTables = new Set(
    Object.values(snapshot.tables ?? {})
      .map((table) => String(table?.name ?? ""))
      .filter(Boolean),
  );
  compareSets("snapshot", snapshotTables, "current schema", expectedTables, out);
}

function verifyManualGap({
  latest,
  latestSnapshotIdx,
  schemaFiles,
  schemaTables,
  entries,
  failures,
}) {
  if (latestSnapshotIdx < 0 || latestSnapshotIdx >= Number(latest.idx)) {
    failures.push("manual metadata gap has no valid earlier generated snapshot");
    return;
  }
  const manifestPath = join(meta, "manual-baseline.json");
  if (!existsSync(manifestPath)) {
    failures.push(
      "journal is ahead of generated snapshots and drizzle/meta/manual-baseline.json is missing",
    );
    return;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (Number(manifest.snapshotIdx) !== latestSnapshotIdx)
    failures.push("manual baseline snapshotIdx does not match the newest generated snapshot");
  if (Number(manifest.throughJournalIdx) !== Number(latest.idx))
    failures.push("manual baseline throughJournalIdx does not match the migration journal");
  if (String(manifest.throughJournalTag ?? "") !== String(latest.tag))
    failures.push("manual baseline throughJournalTag does not match the migration journal");

  const declaredTables = new Set(
    Array.isArray(manifest.schemaTables) ? manifest.schemaTables.map(String) : [],
  );
  compareSets("manual baseline", declaredTables, "current schema", schemaTables, failures);

  const sourceHash = hashNamedFiles(
    schemaFiles.map((name) => [`src/db/schema/${name}`, join(schemaDir, name)]),
  );
  if (manifest.schemaSourcesSha256 !== sourceHash)
    failures.push("manual baseline schemaSourcesSha256 is stale");

  const safetyPath = join(root, "drizzle", "migration-safety.json");
  const safety = JSON.parse(readFileSync(safetyPath, "utf8"));
  const expectedMigrations = entries
    .filter((entry) => Number(entry.idx) > latestSnapshotIdx)
    .sort((a, b) => Number(a.idx) - Number(b.idx));
  const declared =
    manifest.migrations && typeof manifest.migrations === "object" ? manifest.migrations : {};
  for (const entry of expectedMigrations) {
    const tag = String(entry.tag);
    const sqlPath = join(root, "drizzle", `${tag}.sql`);
    if (!existsSync(sqlPath)) {
      failures.push(`manual-baseline migration SQL is missing: ${tag}`);
      continue;
    }
    const expectedHash = sha256(readFileSync(sqlPath));
    if (declared[tag] !== expectedHash) failures.push(`manual-baseline hash is stale for ${tag}`);
    if (!safety?.migrations?.[tag])
      failures.push(`migration-safety metadata is missing for ${tag}`);
  }
  for (const tag of Object.keys(declared)) {
    if (!expectedMigrations.some((entry) => String(entry.tag) === tag))
      failures.push(`manual baseline contains unexpected migration hash: ${tag}`);
  }
}

function compareSets(leftName, left, rightName, right, out) {
  const missing = [...right].filter((name) => !left.has(name)).sort();
  const extra = [...left].filter((name) => !right.has(name)).sort();
  if (missing.length) out.push(`${leftName} is missing ${rightName} tables: ${missing.join(", ")}`);
  if (extra.length)
    out.push(`${leftName} contains tables absent from ${rightName}: ${extra.join(", ")}`);
}

function hashNamedFiles(files) {
  const hash = createHash("sha256");
  for (const [name, path] of files) {
    hash.update(name, "utf8");
    hash.update("\0", "utf8");
    hash.update(readFileSync(path));
    hash.update("\0", "utf8");
  }
  return hash.digest("hex");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
