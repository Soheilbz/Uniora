import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

/*
 * Provision each lane independently, but only a bounded number at once. The
 * caller supplies cleanup for the exact lane set so a failed batch cannot
 * leave disposable databases behind or touch the canonical local database.
 */
export async function provisionLanes({ concurrency, groupEnv, lanes, root }) {
  const requested = Number(process.env.E2E_PROVISION_CONCURRENCY);
  const provisionConcurrency = Math.max(
    1,
    Math.min(
      concurrency,
      Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : concurrency,
    ),
  );

  function prepareLane(lane) {
    const env = groupEnv(lane.group, lane.project);
    /* Stale state must not survive a database rebuild. */
    rmSync(env.E2E_AUTH_DIR, { recursive: true, force: true });
    rmSync(env.E2E_STATE_FILE, { force: true });
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
        resolveResult({ code: code ?? 1, error, lane, label, signal, stdout, stderr });
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
      const env = groupEnv(outcome.lane.group, outcome.lane.project);
      process.stdout.write(`${outcome.label}provision ${env.E2E_DB_NAME}\n`);
      if (outcome.stdout) process.stdout.write(outcome.stdout);
      if (outcome.stderr) process.stderr.write(outcome.stderr);
    }
    return results;
  }

  console.log(`provisioning in batches of ${provisionConcurrency}`);
  for (let offset = 0; offset < lanes.length; offset += provisionConcurrency) {
    const results = await provisionBatch(lanes.slice(offset, offset + provisionConcurrency));
    const failed = results.find((outcome) => outcome.code !== 0);
    if (failed) {
      const message = `${failed.label}provision failed${failed.error ? `: ${failed.error.message}` : ""}`;
      const error = new Error(message);
      error.exitCode = failed.code;
      throw error;
    }
  }
}
