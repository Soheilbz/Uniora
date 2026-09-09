/**
 * Tamper-evident daily seal for tenant + platform audit logs.
 *
 * The seal lives outside PostgreSQL. A privileged database operator can alter
 * rows, but cannot recreate a valid historical HMAC without the independent
 * AUDIT_SEAL_KEY. Each file also commits to the preceding seal so removal or
 * substitution in the chain is detectable.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import pg from "pg";

const { Client } = pg;
const url = process.env.DATABASE_ADMIN_URL?.trim();
const operator = process.env.PLATFORM_OPERATOR?.trim();
const key = process.env.AUDIT_SEAL_KEY?.trim();
const root = resolve(process.env.AUDIT_SEAL_DIR?.trim() || "./audit-seals");
if (!url) fail("DATABASE_ADMIN_URL is required");
if (!operator) fail("PLATFORM_OPERATOR is required");
if (!key || key.length < 32) fail("AUDIT_SEAL_KEY must contain at least 32 characters");
mkdirSync(root, { recursive: true, mode: 0o700 });
chmodSync(root, 0o700);

const [command, ...args] = process.argv.slice(2);
const askedDate = option(args, "--date");
const askedFile = option(args, "--file");
const client = new Client({ connectionString: url, application_name: "univ-audit-seal" });
await client.connect();
try {
  if (command === "create") await createSeal(requiredPastDate(askedDate));
  else if (command === "verify") await verifyCommand(askedFile, askedDate);
  else
    fail(
      "usage: audit-seal.mjs create --date YYYY-MM-DD | verify (--file PATH | --date YYYY-MM-DD)",
    );
} finally {
  await client.end();
}

async function createSeal(date) {
  const file = sealPath(date);
  if (existsSync(file))
    throw new Error(
      `seal already exists: ${basename(file)}; verify it instead of overwriting history`,
    );
  const previous = previousSealBefore(date);
  const measured = await digestDay(date);
  const payload = {
    version: 1,
    date,
    createdAt: new Date().toISOString(),
    algorithm: "sha256+hmac-sha256",
    digest: measured.digest,
    rowCount: measured.rowCount,
    previousSealDate: previous?.date ?? null,
    previousSealHmac: previous?.hmac ?? null,
  };
  const seal = { ...payload, hmac: sign(payload) };
  writeFileSync(file, `${JSON.stringify(seal, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  chmodSync(file, 0o600);
  await client.query(
    `insert into platform_audit_log(operator,action,target,changes,outcome)
     values($1,'audit.seal.created',$2,$3,'success')`,
    [
      operator,
      date,
      JSON.stringify({ digest: seal.digest, rowCount: seal.rowCount, hmac: seal.hmac }),
    ],
  );
  console.log(
    JSON.stringify({ file, date, digest: seal.digest, rowCount: seal.rowCount, hmac: seal.hmac }),
  );
}

async function verifyCommand(fileArg, dateArg) {
  const file = fileArg ? containedFile(fileArg) : sealPath(requiredDate(dateArg));
  const seen = new Set();
  const result = await verifyChain(file, seen);
  console.log(JSON.stringify({ file, verified: true, chainLength: seen.size, ...result }));
}

async function verifyChain(file, seen) {
  const canonical = containedFile(file);
  if (seen.has(canonical)) throw new Error("audit seal chain contains a cycle");
  seen.add(canonical);
  const seal = readSeal(canonical);
  const payload = payloadOf(seal);
  assertHmac(sign(payload), seal.hmac, `invalid HMAC for ${seal.date}`);
  const measured = await digestDay(seal.date);
  if (measured.digest !== seal.digest || measured.rowCount !== seal.rowCount) {
    throw new Error(`audit rows no longer match seal ${seal.date}`);
  }
  if (seal.previousSealDate === null || seal.previousSealHmac === null) {
    if (seal.previousSealDate !== null || seal.previousSealHmac !== null)
      throw new Error(`incomplete previous-seal link for ${seal.date}`);
    return { date: seal.date, digest: seal.digest, rowCount: seal.rowCount };
  }
  if (!(seal.previousSealDate < seal.date))
    throw new Error(`previous seal date is not earlier than ${seal.date}`);
  const previousFile = sealPath(seal.previousSealDate);
  if (!existsSync(previousFile))
    throw new Error(`previous audit seal is missing: ${seal.previousSealDate}`);
  const previous = readSeal(previousFile);
  assertHmac(previous.hmac, seal.previousSealHmac, `seal chain link is broken at ${seal.date}`);
  await verifyChain(previousFile, seen);
  return { date: seal.date, digest: seal.digest, rowCount: seal.rowCount };
}

async function digestDay(date) {
  const start = `${date}T00:00:00.000Z`;
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const end = next.toISOString();
  const hash = createHash("sha256");
  let rowCount = 0;
  hash.update("univ-web-audit-seal-v1\n");
  for (const section of ["tenant", "platform"]) {
    hash.update(`section:${section}\n`);
    let cursorTime = start;
    let cursorId = "00000000-0000-0000-0000-000000000000";
    for (;;) {
      const query = section === "tenant" ? tenantPageSql : platformPageSql;
      const result = await client.query(query, [start, end, cursorTime, cursorId, 1000]);
      if (result.rows.length === 0) break;
      for (const row of result.rows) {
        hash.update(`${JSON.stringify(row)}\n`);
        rowCount += 1;
      }
      const last = result.rows.at(-1);
      cursorTime = new Date(last.created_at).toISOString();
      cursorId = last.id;
      if (result.rows.length < 1000) break;
    }
  }
  return { digest: hash.digest("hex"), rowCount };
}

const tenantPageSql = `
  select id,tenant_id,actor_id,subject_id,action,entity_type,entity_id,changes,
         outcome,source,request_id,session_id,ip_address,user_agent,created_at
    from audit_log
   where created_at >= $1::timestamptz and created_at < $2::timestamptz
     and (created_at,id) > ($3::timestamptz,$4::uuid)
   order by created_at,id
   limit $5`;
const platformPageSql = `
  select id,operator,action,tenant_id,target,changes,outcome,request_id,created_at
    from platform_audit_log
   where created_at >= $1::timestamptz and created_at < $2::timestamptz
     and (created_at,id) > ($3::timestamptz,$4::uuid)
   order by created_at,id
   limit $5`;

function sign(payload) {
  return createHmac("sha256", key).update(JSON.stringify(payload)).digest("hex");
}
function payloadOf(seal) {
  return {
    version: seal.version,
    date: seal.date,
    createdAt: seal.createdAt,
    algorithm: seal.algorithm,
    digest: seal.digest,
    rowCount: seal.rowCount,
    previousSealDate: seal.previousSealDate,
    previousSealHmac: seal.previousSealHmac,
  };
}
function readSeal(file) {
  const value = JSON.parse(readFileSync(file, "utf8"));
  if (value?.version !== 1 || value.algorithm !== "sha256+hmac-sha256")
    throw new Error(`unsupported audit seal: ${basename(file)}`);
  requiredDate(value.date);
  if (!/^[0-9a-f]{64}$/.test(value.digest ?? "") || !/^[0-9a-f]{64}$/.test(value.hmac ?? ""))
    throw new Error(`invalid seal digest/HMAC: ${basename(file)}`);
  if (!Number.isInteger(value.rowCount) || value.rowCount < 0)
    throw new Error(`invalid seal rowCount: ${basename(file)}`);
  return value;
}
function previousSealBefore(date) {
  const candidates = readdirSync(root)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name) && name.slice(0, 10) < date)
    .sort();
  if (candidates.length === 0) return null;
  const previous = readSeal(join(root, candidates.at(-1)));
  return { date: previous.date, hmac: previous.hmac };
}
function sealPath(date) {
  return containedFile(join(root, `${requiredDate(date)}.json`));
}
function containedFile(file) {
  const value = resolve(file);
  if (resolve(value, "..") !== root) throw new Error("audit seal path escapes AUDIT_SEAL_DIR");
  return value;
}
function requiredPastDate(value) {
  const date = requiredDate(value);
  const today = new Date().toISOString().slice(0, 10);
  if (date >= today) throw new Error("seal creation is allowed only for a completed UTC day");
  return date;
}
function requiredDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) fail("--date must be YYYY-MM-DD");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
    fail("--date is invalid");
  return value;
}
function assertHmac(actual, expected, message) {
  const a = Buffer.from(actual, "hex");
  const b = Buffer.from(expected ?? "", "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error(message);
}
function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
function fail(message) {
  console.error(message);
  process.exit(1);
}
