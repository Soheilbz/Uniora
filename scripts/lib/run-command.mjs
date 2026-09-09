import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export function executable(name) {
  return name;
}

export function run(command, args = [], options = {}) {
  const result = spawnSync(executable(command), args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: options.stdio ?? "inherit",
    encoding: options.encoding,
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const rendered = [command, ...args].join(" ");
    throw new Error(
      `${options.label ?? rendered} failed with exit code ${result.status ?? "unknown"}`,
    );
  }
  return result;
}

export function step(name, command, args = [], options = {}) {
  console.log(`\n=== ${name} ===`);
  return run(command, args, { ...options, label: name });
}

export function runNode(script, args = [], options = {}) {
  return run(process.execPath, [script, ...args], options);
}

export function runPnpm(args = [], options = {}) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && /pnpm(?:\.c?js)?$/i.test(npmExecPath)) {
    return run(process.execPath, [npmExecPath, ...args], options);
  }
  return run("pnpm", args, options);
}

export function frozenInstallArgs(cwd) {
  const root = resolve(cwd);
  const store = resolve(process.env.UNIV_PNPM_STORE ?? join(root, ".univ", "cache", "pnpm-store"));
  if (existsSync(join(store, "v11", "index.db"))) {
    return ["install", "--frozen-lockfile", "--offline", "--store-dir", store];
  }
  return ["install", "--frozen-lockfile"];
}
