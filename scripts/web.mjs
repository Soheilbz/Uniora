import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_WEB_PORT, findFreePort } from "./runtime-port.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDir = join(root, ".univ", "runtime");
const statePath = join(runtimeDir, "web.json");
const mode = process.argv[2] === "start" ? "start" : "dev";
const shouldOpen = process.argv.includes("--open");
if (process.platform !== "linux") {
  throw new Error("This launcher supports the project's Linux runtime target only.");
}

/*
 * Standalone Next does not load `.env.*` files for us.  More importantly, a
 * production process must not appear to have started and only fail later when
 * the instrumentation hook first imports the runtime configuration.  Validate
 * the exact environment that will be handed to the child before selecting a
 * port or writing the runtime record.
 */
if (mode === "start") {
  const checked = spawnSync(
    process.execPath,
    [join(root, "scripts", "production-check.mjs"), "--strict"],
    {
      cwd: root,
      env: process.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (checked.status !== 0) {
    console.error("Production configuration check failed; the web server was not started.");
    const details = `${checked.stdout ?? ""}${checked.stderr ?? ""}`.trim();
    if (details) console.error(details);
    process.exit(checked.status ?? 1);
  }
}

function commandLine(pid) {
  if (!pid) return "";
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8");
  } catch {
    return "";
  }
}

function isOurProcess(pid) {
  const line = commandLine(pid).toLowerCase();
  return Boolean(line?.includes(root.toLowerCase()) && line.includes("scripts/web.mjs"));
}

function isOurServerProcess(pid) {
  const line = commandLine(pid).toLowerCase();
  if (!line?.includes(root.toLowerCase())) return false;
  return line.includes("node_modules/next/dist/bin/next") || line.includes("standalone/server.js");
}

function managedStateIsAlive(state) {
  return isOurProcess(Number(state?.launcherPid)) || isOurServerProcess(Number(state?.serverPid));
}

async function stopOwnServer() {
  if (!existsSync(statePath)) {
    console.log("No managed web server is recorded.");
    return;
  }
  let state;
  try {
    state = JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    rmSync(statePath, { force: true });
    console.log("Removed an invalid web runtime record.");
    return;
  }
  const pid = Number(state.launcherPid);
  const serverPid = Number(state.serverPid);
  const launcherOwned = isOurProcess(pid);
  const serverOwned = isOurServerProcess(serverPid);
  const belongsToThisServer = launcherOwned || serverOwned;
  if (!belongsToThisServer) {
    if (await portIsBound(state.port)) {
      console.log(
        `The recorded web port ${state.port} is still serving; process ownership could not be verified, so the runtime record was retained.`,
      );
      return;
    }
    console.log("The recorded processes no longer belong to this project; nothing was stopped.");
    rmSync(statePath, { force: true });
    return;
  }
  if (launcherOwned) {
    process.kill(pid, "SIGTERM");
  } else if (serverOwned) {
    process.kill(serverPid, "SIGTERM");
  }
  rmSync(statePath, { force: true });
  console.log(`Stopped the managed web server on port ${state.port}.`);
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

if (process.argv[2] === "stop") {
  await stopOwnServer();
  process.exit(0);
}

if (existsSync(statePath)) {
  try {
    const existing = JSON.parse(readFileSync(statePath, "utf8"));
    if (managedStateIsAlive(existing) || (await portIsBound(existing.port))) {
      console.error(
        `A managed web server is already running at ${existing.url}. Use pnpm web:stop first; the recorded state was retained.`,
      );
      process.exit(1);
    }
  } catch {
    /* The stale record is safe to replace after the process checks fail. */
  }
  rmSync(statePath, { force: true });
}

const explicitPort = Number(process.env.PORT || process.env.UNIV_WEB_PORT || 0);
const nextBin = join(root, "node_modules", "next", "dist", "bin", "next");
/* Keep the long-lived development server's Turbopack database separate from
 * release builds. `pnpm build` may legitimately run while the local stack is
 * open; sharing `.next` makes those two writers corrupt one another's cache and
 * turns the next request into a misleading 500. An explicit NEXT_DIST_DIR
 * still wins for CI/E2E or a host with its own layout. */
const buildDir = process.env.NEXT_DIST_DIR?.trim() || (mode === "dev" ? ".next-dev" : ".next");
const standaloneServer = join(root, buildDir, "standalone", "server.js");
/* Next dev is single-owner per build directory.  A server that survived
 * outside our runtime record can therefore make a freshly selected port
 * unusable: the port is free, but Next refuses the second process on its lock.
 * Fail before spawning anything so the launcher never reports a server that
 * is about to die.  `pnpm web:stop` remains the safe recovery path for a
 * managed process; a stale lock should be removed only after checking that no
 * Next process for this project is still running. */
if (mode === "dev") {
  const devLockPath = join(root, buildDir, "dev", "lock");
  if (existsSync(devLockPath)) {
    if (developmentLockOwnerIsLive(devLockPath)) {
      console.error(
        `Next development lock exists at ${devLockPath}. ` +
          "A development server may already be running; use pnpm web:stop or inspect it before retrying.",
      );
      process.exit(1);
    }
    rmSync(devLockPath, { force: true });
    console.log(`Removed stale Next development lock: ${devLockPath}`);
  }
}
const port = await findFreePort({ preferred: explicitPort > 0 ? explicitPort : DEFAULT_WEB_PORT });
const nextArgs = mode === "start" ? [standaloneServer] : [nextBin, "dev", "--port", String(port)];
/*
 * A Quick Tunnel is an explicit, temporary deployment. When one is supplied,
 * Better Auth must see that public origin or it will reject the browser's
 * Origin header even though the page itself is reachable. Keep the default
 * local origin for ordinary development; the public value is opt-in and is
 * never persisted in the repository.
 */
const publicOrigin = process.env.UNIV_PUBLIC_ORIGIN?.trim();
const authUrl = publicOrigin || `http://127.0.0.1:${port}`;
if (publicOrigin) {
  let parsedPublicOrigin;
  try {
    parsedPublicOrigin = new URL(publicOrigin);
  } catch {
    console.error("UNIV_PUBLIC_ORIGIN must be an absolute http(s) URL.");
    process.exit(1);
  }
  if (!parsedPublicOrigin || !["http:", "https:"].includes(parsedPublicOrigin.protocol)) {
    console.error("UNIV_PUBLIC_ORIGIN must use http or https.");
    process.exit(1);
  }
  if (parsedPublicOrigin.pathname !== "/" || parsedPublicOrigin.search || parsedPublicOrigin.hash) {
    console.error("UNIV_PUBLIC_ORIGIN must be a bare origin without a path, query, or hash.");
    process.exit(1);
  }
}

mkdirSync(runtimeDir, { recursive: true });
const childEnv = {
  ...process.env,
  PORT: String(port),
  /* Never inherit the machine's HOSTNAME: it can bind Next to a
     LAN-resolvable name and accidentally expose the origin outside the
     Cloudflare Tunnel. An explicit opt-in is required to bind elsewhere. */
  HOSTNAME: process.env.UNIV_BIND_HOST || "127.0.0.1",
  ...(mode === "dev"
    ? {
        BETTER_AUTH_URL: authUrl,
        TRUSTED_ORIGINS: publicOrigin ? `${authUrl},http://127.0.0.1:${port}` : authUrl,
        NEXT_DIST_DIR: buildDir,
      }
    : {}),
};
/* NEXT_DIST_DIR selects the standalone artifact for this launcher. The generated
 * server runs from the artifact root and must not reinterpret that selector. */
if (mode === "start") delete childEnv.NEXT_DIST_DIR;
const child = spawn(process.execPath, nextArgs, {
  cwd: mode === "start" ? dirname(standaloneServer) : root,
  env: childEnv,
  stdio: "inherit",
});

writeFileSync(
  statePath,
  JSON.stringify(
    { launcherPid: process.pid, serverPid: child.pid, port, mode, url: `${authUrl}/sign-in` },
    null,
    2,
  ),
);
console.log(`\nWeb server (${mode}) is starting at ${authUrl}`);
console.log(`Runtime record: ${statePath}`);
if (shouldOpen) openBrowser(`${authUrl}/sign-in`);

function openBrowser(url) {
  const opener = spawn("xdg-open", [url], { stdio: "ignore" });
  opener.once("error", (cause) => {
    console.warn(
      `Unable to open the browser automatically (${cause.message}). Open ${url} manually.`,
    );
  });
}

let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  if (child.exitCode !== null) return;
  child.kill(signal);
}

function developmentLockOwnerIsLive(lockPath) {
  try {
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    const pid = Number(lock.pid);
    if (!Number.isInteger(pid) || pid <= 1) return false;
    process.kill(pid, 0);
    const commandLine = readFileSync(`/proc/${pid}/cmdline`, "utf8").toLowerCase();
    const workingDirectory = readFileSync(`/proc/${pid}/cwd`, "utf8");
    return (
      workingDirectory === root &&
      (commandLine.includes("next") || commandLine.includes("next-server"))
    );
  } catch {
    return false;
  }
}

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));
process.once("exit", () => {
  if (child.exitCode === null) {
    child.kill();
  }
  rmSync(statePath, { force: true });
});
child.once("error", (cause) => {
  console.error("Unable to start the Next.js server:", cause);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  stopping = true;
  rmSync(statePath, { force: true });
  process.exit(signal ? 1 : (code ?? 0));
});
