#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const runtimeDir = join(root, ".univ", "runtime");
const statePath = join(runtimeDir, "local-stack.json");
const startLockPath = join(runtimeDir, "local-stack.start.lock");
const node = process.execPath;
const children = new Map();
let stopping = false;
let startLockFd = null;

if (process.argv[2] === "stop") {
  await stopRecordedStack();
  process.exit(0);
}
if (process.argv[2] === "status") {
  await statusRecordedStack();
  process.exit(0);
}
if (process.argv[2] !== "start") {
  console.error("usage: node scripts/local-stack.mjs start|stop|status");
  process.exit(64);
}

acquireStartLock();
process.once("exit", releaseStartLock);

if (await recordedStackAlive()) {
  console.error(`Local stack is already running; use pnpm local:stop first (${statePath}).`);
  process.exit(1);
}
const existingSupervisors = localStackSupervisorPids();
if (existingSupervisors.length > 0) {
  console.error(
    `A local stack supervisor is already running for this checkout (PID ${existingSupervisors.join(", ")}); use pnpm local:stop first.`,
  );
  process.exit(1);
}
rmSync(statePath, { force: true });
mkdirSync(runtimeDir, { recursive: true });
/* If this project's managed Web launcher is already running, hand ownership
 * to this supervisor. web.mjs stop only accepts a process it can prove belongs
 * to this checkout; an unrelated service is never terminated. */
spawnSync(node, ["scripts/web.mjs", "stop"], { cwd: root, stdio: "inherit" });
await reapOrphanedServices();

const commands = [
  ["object-storage", "scripts/local-object-storage.mjs"],
  ["antivirus", "scripts/local-antivirus.mjs"],
  ["tenant-worker", "scripts/worker-env.mjs", "scripts/job-worker.mjs"],
  ["platform-worker", "scripts/platform-worker-env.mjs", "scripts/platform-worker.ts"],
  ["web", "scripts/web.mjs", "dev"],
];

for (const [name, ...args] of commands) launch(name, args);
writeState();
console.log(`Local full stack is running (${statePath}).`);
console.log("Web: http://127.0.0.1:3020/sign-in");

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => shutdown(signal));
process.once("exit", () => {
  for (const child of children.values()) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  try {
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    if (Number(state.supervisorPid) === process.pid) rmSync(statePath, { force: true });
  } catch {
    /* The record may already have been removed during shutdown. */
  }
});

function acquireStartLock() {
  mkdirSync(runtimeDir, { recursive: true });
  for (;;) {
    try {
      startLockFd = openSync(startLockPath, "wx", 0o600);
      writeFileSync(
        startLockPath,
        JSON.stringify({ pid: process.pid, root, startedAt: new Date().toISOString() }),
        { mode: 0o600 },
      );
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let ownerPid = 0;
      try {
        ownerPid = Number(JSON.parse(readFileSync(startLockPath, "utf8")).pid);
      } catch {
        /* A writer may be between create and write; retry after a short wait. */
      }
      if (ownerPid > 1 && processBelongsToLocalStack(ownerPid)) {
        console.error("Another local stack start is already in progress; wait for it to finish.");
        process.exit(1);
      }
      try {
        unlinkSync(startLockPath);
      } catch {
        /* The competing starter may have completed and removed the lock. */
      }
    }
  }
}

function releaseStartLock() {
  if (startLockFd === null) return;
  try {
    closeSync(startLockFd);
  } catch {
    /* Already closed. */
  }
  startLockFd = null;
  try {
    const lock = JSON.parse(readFileSync(startLockPath, "utf8"));
    if (Number(lock.pid) === process.pid) unlinkSync(startLockPath);
  } catch {
    /* The lock was already reclaimed or never fully written. */
  }
}

function launch(name, args) {
  const child = spawn(node, args, { cwd: root, env: process.env, stdio: "inherit" });
  children.set(name, child);
  child.once("error", (error) => console.error(`[${name}] failed to start: ${error.message}`));
  child.once("exit", (code, signal) => {
    if (stopping) return;
    console.error(`[${name}] exited (${signal || code}); restarting in 2s.`);
    setTimeout(() => {
      if (!stopping) {
        children.delete(name);
        launch(name, args);
        writeState();
      }
    }, 2000).unref();
  });
}

function writeState() {
  writeFileSync(
    statePath,
    JSON.stringify(
      {
        supervisorPid: process.pid,
        startedAt: new Date().toISOString(),
        children: Object.fromEntries([...children].map(([name, child]) => [name, child.pid])),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}

async function stopRecordedStack() {
  reclaimStaleStartLock();
  if (!existsSync(statePath)) {
    const reaped = await reapOrphanedServices();
    console.log(
      reaped.length > 0
        ? `Local stack is not recorded; stopped ${reaped.length} orphaned local service(s).`
        : "Local stack is not recorded as running.",
    );
    return;
  }
  try {
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    const pid = Number(state.supervisorPid);
    if (!processBelongsToLocalStack(pid) && (await recordedWebPortAlive())) {
      console.log(
        "The recorded Web port is still serving; process ownership could not be verified, so the local stack record was retained.",
      );
      return;
    }
    if (Number.isInteger(pid) && pid > 1) process.kill(pid, "SIGTERM");
    await waitForProcessExit(pid, 5000);
    const reaped = await reapOrphanedServices();
    console.log(
      reaped.length > 0
        ? `Requested shutdown of the local full stack; stopped ${reaped.length} orphaned local service(s).`
        : "Requested shutdown of the local full stack.",
    );
  } catch {
    rmSync(statePath, { force: true });
    const reaped = await reapOrphanedServices();
    console.log(
      reaped.length > 0
        ? `Removed an invalid local stack record and stopped ${reaped.length} orphaned local service(s).`
        : "Removed an invalid local stack record.",
    );
  }
}

function reclaimStaleStartLock() {
  if (!existsSync(startLockPath)) return;
  let ownerPid = 0;
  try {
    ownerPid = Number(JSON.parse(readFileSync(startLockPath, "utf8")).pid);
  } catch {
    /* A truncated lock cannot identify a live starter and is safe to reclaim. */
  }
  if (ownerPid > 1 && processBelongsToLocalStack(ownerPid)) return;
  try {
    unlinkSync(startLockPath);
  } catch {
    /* The active starter may have removed it between the checks. */
  }
}

async function statusRecordedStack() {
  if (!existsSync(statePath)) {
    if (await recordedWebPortAlive()) {
      console.log("Local Web is serving, but the local stack supervisor record is missing.");
      return;
    }
    console.log("Local stack is not running.");
    return;
  }
  try {
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    const supervisorAlive = processBelongsToLocalStack(state.supervisorPid);
    if (!supervisorAlive) {
      const webReachable = await recordedWebPortAlive();
      console.log(
        JSON.stringify(
          {
            ...state,
            supervisorAlive: false,
            webReachable,
            state: webReachable ? "ownership-unverified" : "stale-record-retained",
          },
          null,
          2,
        ),
      );
      return;
    }

    const childStatus = Object.fromEntries(
      Object.entries(state.children ?? {}).map(([name, pid]) => [
        name,
        {
          pid,
          alive: processAlive(pid),
        },
      ]),
    );
    console.log(JSON.stringify({ ...state, supervisorAlive, children: childStatus }, null, 2));
  } catch {
    rmSync(statePath, { force: true });
    console.log("Removed an invalid local stack record.");
  }
}

async function recordedStackAlive() {
  if (!existsSync(statePath)) return false;
  try {
    const pid = Number(JSON.parse(readFileSync(statePath, "utf8")).supervisorPid);
    return processBelongsToLocalStack(pid) || (await recordedWebPortAlive());
  } catch {
    return false;
  }
}

async function recordedWebPortAlive() {
  const webStatePath = join(runtimeDir, "web.json");
  if (!existsSync(webStatePath)) return false;
  try {
    const state = JSON.parse(readFileSync(webStatePath, "utf8"));
    return await portIsBound(state.port);
  } catch {
    return false;
  }
}

function portIsBound(port) {
  const parsed = Number(port);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65_535) return Promise.resolve(false);
  return new Promise((resolvePort) => {
    const socket = net.createConnection({ host: "127.0.0.1", port: parsed });
    const finish = (bound) => {
      socket.destroy();
      resolvePort(bound);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(500, () => finish(false));
  });
}

function processAlive(pid) {
  const parsed = Number(pid);
  if (!Number.isInteger(parsed) || parsed <= 1) return false;
  try {
    process.kill(parsed, 0);
    return true;
  } catch {
    return false;
  }
}

function processBelongsToLocalStack(pid) {
  if (!processAlive(pid)) return false;
  try {
    if (process.platform === "linux" && readlinkSync(`/proc/${Number(pid)}/exe`) !== node)
      return false;
    const commandLine = readFileSync(`/proc/${Number(pid)}/cmdline`, "utf8");
    return commandLine.includes("scripts/local-stack.mjs");
  } catch {
    // The PID probe remains useful on hosts without Linux /proc.
    return processAlive(pid);
  }
}

function localStackSupervisorPids() {
  if (process.platform !== "linux") return [];
  const found = [];
  for (const entry of readdirSync("/proc", { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    const pid = Number(entry.name);
    if (pid <= 1 || pid === process.pid) continue;
    try {
      if (readlinkSync(`/proc/${pid}/cwd`) !== root) continue;
      if (readlinkSync(`/proc/${pid}/exe`) !== node) continue;
      const commandLine = readFileSync(`/proc/${pid}/cmdline`, "utf8");
      if (commandLine.includes("scripts/local-stack.mjs")) found.push(pid);
    } catch {
      /* Process exited between directory enumeration and inspection. */
    }
  }
  return found;
}

/*
 * A terminal closing or a killed supervisor can leave the two development
 * adapters alive while their state file disappears. Only reap processes whose
 * cwd is this checkout and whose command line names one of these exact
 * development-only scripts; never infer ownership from a port alone.
 */
const orphanableScripts = [
  "scripts/local-object-storage.mjs",
  "scripts/local-antivirus.mjs",
  "scripts/worker-env.mjs",
  "scripts/platform-worker-env.mjs",
  "scripts/job-worker.mjs",
  "scripts/platform-worker.ts",
];

function orphanedServicePids() {
  if (process.platform !== "linux") return [];
  const found = new Set();
  for (const entry of readdirSync("/proc", { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    const pid = Number(entry.name);
    if (pid <= 1 || pid === process.pid) continue;
    try {
      if (readlinkSync(`/proc/${pid}/cwd`) !== root) continue;
      const commandLine = readFileSync(`/proc/${pid}/cmdline`, "utf8");
      if (orphanableScripts.some((script) => commandLine.includes(script))) found.add(pid);
    } catch {
      /* Process exited between directory enumeration and inspection. */
    }
  }
  return [...found];
}

async function reapOrphanedServices() {
  const pids = orphanedServicePids();
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* Already gone. */
    }
  }
  for (const pid of pids) await waitForProcessExit(pid, 2000);
  for (const pid of pids) {
    if (!processAlive(pid)) continue;
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* Already gone. */
    }
  }
  return pids.filter((pid) => !processAlive(pid));
}

function waitForProcessExit(pid, timeoutMs) {
  if (!processAlive(pid)) return Promise.resolve();
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolveWait) => {
    const check = () => {
      if (!processAlive(pid) || Date.now() >= deadline) return resolveWait();
      setTimeout(check, 50);
    };
    check();
  });
}

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`Stopping local full stack (${signal}).`);
  for (const child of children.values()) if (child.exitCode === null) child.kill("SIGTERM");
  setTimeout(() => process.exit(0), 5000).unref();
}
