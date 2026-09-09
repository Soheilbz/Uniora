import { spawnSync } from "node:child_process";
import { request } from "node:https";

const timeoutMs = Math.min(
  30_000,
  Math.max(1_000, Number(process.env.UNIV_REGISTRY_PROBE_TIMEOUT_MS ?? 8_000)),
);
const requireNpm = process.argv.includes("--require-npm");

const probes = [
  {
    name: "docker-registry",
    url: "https://registry-1.docker.io/v2/",
    expected: "auth-challenge",
  },
  {
    name: "npm-pnpm-tarball",
    url: "https://registry.npmjs.org/pnpm/-/pnpm-11.21.0.tgz",
    expected: "ok",
  },
];

const docker = command("docker", ["info", "--format", "{{.ServerVersion}}"]);
const buildx = command("docker", ["buildx", "version"]);
const results = await Promise.all(probes.map(probe));
const report = {
  timeoutMs,
  docker: { available: docker.status === 0, output: docker.output.trim() },
  buildx: { available: buildx.status === 0, output: buildx.output.trim() },
  probes: results,
};
console.log(JSON.stringify(report, null, 2));

const dockerOk = docker.status === 0 && buildx.status === 0;
const registryOk = results.every(
  (result) => result.name !== "docker-registry" || result.classification === "auth-challenge",
);
const npmOk = results.find((result) => result.name === "npm-pnpm-tarball")?.classification === "ok";
if (!dockerOk || !registryOk || (requireNpm && !npmOk)) process.exit(1);

function command(file, args) {
  const result = spawnSync(file, args, { encoding: "utf8" });
  return {
    status: result.status ?? 1,
    output: [result.stdout, result.stderr].filter(Boolean).join(" "),
  };
}

function probe({ name, url, expected }) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const req = request(
      url,
      { method: "HEAD", headers: { "user-agent": "univ-web-docker-preflight/1" } },
      (response) => {
        response.resume();
        const classification = classifyStatus(response.statusCode ?? 0, name);
        resolve({
          name,
          url,
          expected,
          classification,
          status: response.statusCode,
          elapsedMs: Date.now() - startedAt,
        });
      },
    );
    req.setTimeout(timeoutMs, () =>
      req.destroy(Object.assign(new Error("probe timeout"), { code: "ETIMEDOUT" })),
    );
    req.on("error", (error) => {
      resolve({
        name,
        url,
        expected,
        classification: classifyError(error),
        code: error.code,
        message: error.message,
        elapsedMs: Date.now() - startedAt,
      });
    });
    req.end();
  });
}

function classifyStatus(status, name) {
  if (name === "docker-registry" && status === 401) return "auth-challenge";
  if (status === 429) return "rate-limit";
  if (status >= 500) return "registry-server";
  if (status >= 400) return "http-error";
  return "ok";
}

function classifyError(error) {
  const code = String(error.code ?? "");
  if (["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL", "EAI_NODATA"].includes(code)) return "dns";
  if (["ETIMEDOUT", "ESOCKETTIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(code)) return "timeout";
  if (/TLS|SSL|CERT/i.test(`${code} ${error.message}`)) return "tls";
  return "network";
}
