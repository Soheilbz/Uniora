import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findFreePorts } from "../runtime-port.ts";
import { startPlatformWorker } from "./platform-worker.mjs";

/**
 * Runs the E2E suite as several parallel groups.
 *
 * Each group is a complete, independent pipeline: its own database
 * (`univ_web_e2e_<run-id>_g<i>`), its own server on its own port, its own sign-in
 * states and fixture ids — so a test that counts rows in a shared register
 * still sees a world no other test is touching. Within a group everything
 * stays strictly serial, exactly as the one-worker config always ran; the
 * wall-clock win comes from a bounded number of groups running side by side;
 * starting every browser engine for every group at once can exhaust the
 * shared PostgreSQL/CPU budget even though each group is isolated.
 *
 *   pnpm e2e            # build once, then all groups
 *   pnpm e2e:fast       # reuse the current standalone build
 *   node scripts/e2e/run.mjs --shards 6 --no-build
 *   node scripts/e2e/run.mjs --shards 1 --no-build --spec date-picker.spec.ts
 *
 * With --shards 1 (or E2E_SHARDS=1) this is the classic single run.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");

/*
 * Project-local scratch space, set before anything is built or spawned.
 *
 * Every child this runner creates — the build, the provisioning scripts, the
 * Playwright hosts and through them the servers and browsers — inherits these,
 * so transform caches, Chromium scratch profiles and any accidental browser
 * download land under `.univ/` instead of the user profile or the system temp
 * area. Each invocation gets a fresh directory, so a locked profile from a
 * killed run can never prevent the next run from starting. (playwright.config.ts
 * pins the same project-local parent for a direct `playwright test` invocation.)
 */
const runtimeTmp = join(
  root,
  ".univ",
  "runtime",
  "tmp",
  `e2e-${Date.now()}-${randomUUID().slice(0, 8)}`,
);
const runtimeTmpParent = dirname(runtimeTmp);
const staleScratchCutoff = Date.now() - 24 * 60 * 60 * 1000;
mkdirSync(runtimeTmpParent, { recursive: true });
for (const entry of readdirSync(runtimeTmpParent, { withFileTypes: true })) {
  if (!entry.isDirectory() || !/^e2e-/.test(entry.name)) continue;
  const stalePath = join(runtimeTmpParent, entry.name);
  try {
    if (statSync(stalePath).mtimeMs < staleScratchCutoff) {
      rmSync(stalePath, { recursive: true, force: true });
    }
  } catch {
    /* A locked old profile is harmless and can be swept on a later run. */
  }
}
mkdirSync(runtimeTmp, { recursive: true });
/* The system temp area, captured before it is shadowed below. */
const systemTemp = process.env.TEMP ?? process.env.TMP ?? join(tmpdir(), "..");
process.env.TMPDIR = runtimeTmp;
process.env.TEMP = runtimeTmp;
process.env.TMP = runtimeTmp;
process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(root, ".univ", "cache", "ms-playwright");

/*
 * Sweep this suite's own stale scratch from the system temp area.
 *
 * Two residues can still form there despite the redirection above: the
 * Playwright *host* compiles playwright.config.ts before the config gets a
 * chance to pin TEMP, and a hard-killed Chromium sometimes leaves its scratch
 * profile under the OS temp area regardless of its environment. Both carry
 * unmistakable `playwright` name patterns, so anything older than a day under
 * exactly those names is ours to reclaim — and nothing else there is touched.
 */
if (systemTemp) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const entry of readdirSync(systemTemp, { withFileTypes: true })) {
    if (!/^playwright_(chromiumdev_profile|download|transform)/.test(entry.name)) continue;
    const path = join(systemTemp, entry.name);
    try {
      if (statSync(path).mtimeMs < cutoff) rmSync(path, { recursive: true, force: true });
    } catch {
      /* locked or vanished mid-sweep: someone else's problem this run */
    }
  }
}

const args = process.argv.slice(2);
const shardsFlag = args.indexOf("--shards");
const shardCount = Math.max(
  1,
  Number(shardsFlag >= 0 ? args[shardsFlag + 1] : undefined) || Number(process.env.E2E_SHARDS) || 4,
);
const skipBuild = args.includes("--no-build");
const specFlag = args.indexOf("--spec");
const requestedSpec = specFlag >= 0 ? args[specFlag + 1] : undefined;
const requestedSpecs = requestedSpec
  ? requestedSpec
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
  : undefined;
const projectFlag = args.indexOf("--project");
const requestedProject = projectFlag >= 0 ? args[projectFlag + 1] : undefined;
const projects = requestedProject ? [requestedProject] : ["chromium", "firefox", "webkit"];
if (projects.some((project) => !["chromium", "firefox", "webkit"].includes(project))) {
  throw new Error("--project must be one of chromium, firefox, or webkit");
}
const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const runDatabaseKey = runId.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
const runArtifactsRoot = join(root, "e2e", `.run-${runId}`);

/* Playwright hooks that need direct PostgreSQL cleanup (for example the real
 * login-rate-limit tests) run in the same process as this orchestrator. Give
 * them the exact admin URL used by the provisioning lane; previously only the
 * provisioner/server received it, so auth.spec.ts failed before its first
 * browser assertion on a local checkout. */
function readEnvValue(path, key) {
  if (!existsSync(path)) return "";
  const line = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .find((value) => value.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : "";
}

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const values = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator > 0) {
      values[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
    }
  }
  return values;
}

const e2eAdminUrl =
  process.env.E2E_ADMIN_URL?.trim() ||
  process.env.DATABASE_ADMIN_URL?.trim() ||
  readEnvValue(join(root, ".env.database.local"), "DATABASE_ADMIN_URL");
if (!e2eAdminUrl) {
  throw new Error(
    "E2E_ADMIN_URL or DATABASE_ADMIN_URL is required for the disposable E2E database and auth hooks",
  );
}

const platformWorkerRequested = process.env.E2E_PLATFORM_WORKER === "1";
const platformWorkerFile = readEnvFile(join(root, ".env.platform-worker.local"));

if (!skipBuild) {
  console.log(`── build (${shardCount} shard(s) will follow) ──`);
  const built = spawnSync("pnpm", ["build"], {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });
  if (built.status !== 0) process.exit(built.status ?? 1);
}

/* Standalone builds do not include `static`. Stage it once before any
   parallel lane starts so every shard observes one complete asset tree. */
const buildDir = process.env.NEXT_DIST_DIR?.trim() || ".next";
const standaloneRoot = join(root, buildDir, "standalone");
const standaloneStatic = join(standaloneRoot, buildDir, "static");
if (!existsSync(standaloneStatic)) {
  cpSync(join(root, buildDir, "static"), standaloneStatic, { recursive: true });
}

/* Round-robin over the sorted spec list keeps every group's load even without
   knowing anything about what the tests do. */
const allSpecs = readdirSync(join(root, "e2e"))
  .filter((name) => name.endsWith(".spec.ts"))
  .sort();
const specs = requestedSpecs ? allSpecs.filter((name) => requestedSpecs.includes(name)) : allSpecs;
if (requestedSpecs && specs.length !== requestedSpecs.length) {
  const missing = requestedSpecs.filter((name) => !allSpecs.includes(name));
  console.error(`E2E spec not found: ${missing.join(", ")}`);
  process.exit(1);
}
/* The workflow spec exercises durable queue execution; make the required
   worker automatic so `pnpm e2e` cannot pass setup and then leave that spec
   waiting forever merely because an optional environment flag was omitted. */
const platformWorkerEnabled = platformWorkerRequested || specs.includes("platform-actions.spec.ts");
const groups = Array.from({ length: shardCount }, () => []);
specs.forEach((name, index) => {
  groups[index % shardCount].push(name);
});

const activeGroups = groups
  .map((files, index) => ({ files, index: index + 1 }))
  .filter(({ files }) => files.length > 0);
const lanes = activeGroups.flatMap(({ files, index }) =>
  projects.map((project) => ({ files, group: index, project })),
);

const laneConcurrency = Math.max(
  1,
  /* Two complete browser processes is the safe local/CI baseline. Four was
   * reproducibly capable of exhausting the shared browser/server budget in
   * the full matrix, producing WebKit target crashes and misleading artifact
   * directory ENOENT reports. Keep higher concurrency as an explicit,
   * operator-selected override rather than the qualification default. */
  Math.min(lanes.length, Number(process.env.E2E_LANE_CONCURRENCY) || 2),
);

/* Database provisioning is independent per lane, but it still shares one
 * PostgreSQL cluster. Keep its default bounded by the same safe concurrency
 * budget as the browser phase; an explicit lower value is useful on smaller
 * developer machines without changing the qualification default. */
const provisionConcurrency = Math.max(
  1,
  Math.min(lanes.length, Number(process.env.E2E_PROVISION_CONCURRENCY) || laneConcurrency),
);

/* A lane owns one Web pool, while all lanes share the same disposable
 * PostgreSQL cluster. Keep aggregate E2E demand below the cluster ceiling and
 * leave room for Playwright hooks, provisioning checks and the database's
 * reserved superuser slots. The production process still receives its
 * explicitly configured DATABASE_POOL_MAX; this cap is only for the parallel
 * browser runner, whose lane count is known here. */
const e2ePoolMax = Math.max(2, Math.min(10, Math.floor(60 / laneConcurrency)));

/* A group's environment: every knob the config, the setup project and the
   fixtures read to stay inside their own lane. */
const e2ePorts = await findFreePorts(lanes.length, { preferred: 3021 });
function groupEnv(index, project) {
  const projectIndex = projects.indexOf(project);
  const laneIndex = (index - 1) * projects.length + projectIndex;
  const lane = `${index}-${project}`;
  const port = String(e2ePorts[laneIndex]);
  return {
    NEXT_DIST_DIR: buildDir,
    E2E_PORT: port,
    E2E_BASE_URL: `http://127.0.0.1:${port}`,
    /* Include the run id so a stale runner can never clean up a newer run's
     * database after a retry or an interrupted local test process. */
    E2E_DB_NAME: `univ_web_e2e_${runDatabaseKey}_g${index}_${project}`,
    E2E_AUTH_DIR: join(runArtifactsRoot, `.auth-g${lane}`),
    E2E_STATE_FILE: join(runArtifactsRoot, `.state.g${lane}.json`),
    E2E_ARTIFACTS_DIR: join(runArtifactsRoot, `.artifacts-g${lane}`),
    E2E_ADMIN_URL: e2eAdminUrl,
    DATABASE_POOL_MAX: String(e2ePoolMax),
  };
}

function cleanupLaneDatabases() {
  for (const lane of lanes) {
    const env = groupEnv(lane.group, lane.project);
    const cleaned = spawnSync(process.execPath, [join("scripts", "e2e", "cleanup.mjs")], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, ...env, E2E_ADMIN_URL: e2eAdminUrl },
    });
    if (cleaned.status !== 0) {
      console.error(
        `[g${lane.group}/${lane.project}] cleanup failed:\n${cleaned.stdout}${cleaned.stderr}`,
      );
    }
    rmSync(join(root, ".univ", "e2e-backups", env.E2E_DB_NAME), {
      recursive: true,
      force: true,
    });
  }
}

console.log("── provisioning ──");
function prepareLane(lane) {
  const env = groupEnv(lane.group, lane.project);
  /* Stale cookies or state from an earlier run would survive a rebuild of
     the database only to point at sessions that no longer exist. */
  rmSync(env.E2E_AUTH_DIR, { recursive: true, force: true });
  rmSync(env.E2E_STATE_FILE, { force: true });
  /* Playwright creates this lazily, but all groups start together. Creating
     every output directory up front prevents one group's reporter cleanup
     from observing another group's not-yet-created directory. */
  rmSync(env.E2E_ARTIFACTS_DIR, { recursive: true, force: true });
  mkdirSync(env.E2E_ARTIFACTS_DIR, { recursive: true });
}

function startProvision(lane) {
  const env = groupEnv(lane.group, lane.project);
  const label = `[g${lane.group}/${lane.project}] `;
  const child = spawn(process.execPath, [join("scripts", "e2e", "provision.mjs")], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const result = new Promise((resolveResult) => {
    const finish = (code, signal, error) =>
      resolveResult({ code: code ?? 1, signal, error, lane, label, stdout, stderr });
    child.once("error", (error) => finish(1, null, error));
    child.once("exit", (code, signal) => finish(code, signal));
  });
  return { child, result };
}

async function provisionBatch(batch) {
  const running = batch.map((lane) => {
    prepareLane(lane);
    return startProvision(lane);
  });
  let firstFailure;
  const results = await Promise.all(
    running.map(async ({ result }) => {
      const outcome = await result;
      if (outcome.code !== 0 && !firstFailure) {
        firstFailure = outcome;
        for (const peer of running) {
          if (peer.child.exitCode === null) peer.child.kill("SIGTERM");
        }
      }
      return outcome;
    }),
  );
  for (const outcome of results) {
    process.stdout.write(
      `${outcome.label}provision ${groupEnv(outcome.lane.group, outcome.lane.project).E2E_DB_NAME}\n`,
    );
    if (outcome.stdout) process.stdout.write(outcome.stdout);
    if (outcome.stderr) process.stderr.write(outcome.stderr);
  }
  return results;
}

console.log(`provisioning in batches of ${provisionConcurrency}`);
for (let offset = 0; offset < lanes.length; offset += provisionConcurrency) {
  const batch = lanes.slice(offset, offset + provisionConcurrency);
  const results = await provisionBatch(batch);
  const failed = results.find((outcome) => outcome.code !== 0);
  if (failed) {
    console.error(
      `${failed.label}provision failed${failed.error ? `: ${failed.error.message}` : ""}`,
    );
    cleanupLaneDatabases();
    process.exit(failed.code);
  }
}

/* Line-buffered relay, so concurrent groups cannot interleave mid-line. */
function relay(label, stream, destination) {
  let pending = "";
  stream.on("data", (chunk) => {
    pending += chunk.toString();
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) destination.write(`${label}${line}\n`);
  });
  stream.on("end", () => {
    if (pending) destination.write(`${label}${pending}\n`);
  });
}

const servers = [];
const workers = [];

async function startServer(lane, serverList = servers) {
  const env = {
    ...process.env,
    ...groupEnv(lane.group, lane.project),
    E2E_EXTERNAL_SERVER: "1",
  };
  const label = `[g${lane.group}/${lane.project}] `;
  const server = spawn(process.execPath, [join("scripts", "e2e", "serve.mjs")], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  relay(`${label}[server] `, server.stdout, process.stdout);
  relay(`${label}[server] `, server.stderr, process.stderr);
  serverList.push([`${lane.group}/${lane.project}`, server]);

  const url = `${env.E2E_BASE_URL}/api/readyz`;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`${label}server exited with ${server.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* The standalone server is still starting. */
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`${label}server did not become healthy within 120 seconds`);
}

console.log(
  `── running ${lanes.length} isolated browser lane(s) in batches of ${laneConcurrency}, ${specs.length} spec file(s) ──`,
);
const started = Date.now();
const children = [];

let shuttingDown = false;

/** The runner owns each Linux standalone server and terminates it explicitly. */
function terminateChild(child) {
  if (!child.pid || child.exitCode !== null) return;
  child.kill("SIGTERM");
}

function terminateChildren() {
  for (const [, child] of children) terminateChild(child);
  for (const [, server] of servers) terminateChild(server);
  for (const [, worker] of workers) terminateChild(worker);
}

function waitForExit(child) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolveExit) => child.once("exit", resolveExit));
}

function onSignal(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  terminateChildren();
  cleanupLaneDatabases();
  process.exit(signal === "SIGINT" ? 130 : 143);
}

process.once("SIGINT", onSignal);
process.once("SIGTERM", onSignal);

const codes = [];
for (let offset = 0; offset < lanes.length; offset += laneConcurrency) {
  const batch = lanes.slice(offset, offset + laneConcurrency);
  const batchServers = [];
  const batchWorkers = [];
  console.log(
    `── starting batch ${Math.floor(offset / laneConcurrency) + 1} (${batch.length} lane(s)) ──`,
  );
  try {
    await Promise.all(batch.map((lane) => startServer(lane, batchServers)));
    servers.push(...batchServers);
    if (platformWorkerEnabled) {
      await Promise.all(
        batch.map((lane) =>
          startPlatformWorker({
            lane,
            laneEnv: groupEnv(lane.group, lane.project),
            root,
            platformWorkerFile,
            relay,
            workerList: batchWorkers,
          }),
        ),
      );
      workers.push(...batchWorkers);
    }
  } catch (cause) {
    for (const [, server] of batchServers) terminateChild(server);
    for (const [, worker] of batchWorkers) terminateChild(worker);
    cleanupLaneDatabases();
    console.error("E2E server startup failed:", cause);
    process.exit(1);
  }

  const batchChildren = [];
  for (const lane of batch) {
    const { files } = lane;
    const label = `[g${lane.group}/${lane.project}] `;
    console.log(`${label}${files.join(", ")}`);
    const child = spawn(
      process.execPath,
      [
        join("node_modules", "@playwright", "test", "cli.js"),
        "test",
        ...files,
        `--project=${lane.project}`,
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          ...groupEnv(lane.group, lane.project),
          E2E_EXTERNAL_SERVER: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    relay(label, child.stdout, process.stdout);
    relay(label, child.stderr, process.stderr);
    batchChildren.push([`${lane.group}/${lane.project}`, child]);
    children.push([`${lane.group}/${lane.project}`, child]);
  }

  const batchCodes = await Promise.all(
    batchChildren.map(
      ([lane, child]) =>
        new Promise((resolveExit) => {
          child.once("exit", (code) => resolveExit([lane, code ?? 1]));
          child.once("error", () => resolveExit([lane, 1]));
        }),
    ),
  );
  codes.push(...batchCodes);
  for (const [, server] of batchServers) terminateChild(server);
  for (const [, worker] of batchWorkers) terminateChild(worker);
  await Promise.race([
    Promise.all([
      ...batchServers.map(([, server]) => waitForExit(server)),
      ...batchWorkers.map(([, worker]) => waitForExit(worker)),
    ]),
    new Promise((resolveWait) => setTimeout(resolveWait, 5_000)),
  ]);
}

process.off("SIGINT", onSignal);
process.off("SIGTERM", onSignal);

terminateChildren();
await Promise.race([
  Promise.all([
    ...servers.map(([, server]) => waitForExit(server)),
    ...workers.map(([, worker]) => waitForExit(worker)),
  ]),
  new Promise((resolveWait) => setTimeout(resolveWait, 5_000)),
]);

cleanupLaneDatabases();

const seconds = ((Date.now() - started) / 1000).toFixed(1);
const failed = codes.filter(([, code]) => code !== 0);
for (const [lane, code] of codes) {
  if (code !== 0) console.error(`[g${lane}] FAILED (exit ${code})`);
}
console.log(
  failed.length === 0
    ? `all ${children.length} group(s) passed in ${seconds}s`
    : `${failed.length}/${children.length} group(s) failed in ${seconds}s`,
);
if (failed.length === 0) rmSync(runArtifactsRoot, { recursive: true, force: true });
process.exit(failed.length === 0 ? 0 : 1);
