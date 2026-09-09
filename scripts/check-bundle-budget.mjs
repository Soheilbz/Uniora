import { existsSync, readFileSync, statSync } from "node:fs";
import { join, normalize } from "node:path";

const root = process.cwd();
const nextDir = join(root, ".next");
const manifests = ["build-manifest.json", "app-build-manifest.json"]
  .map((name) => join(nextDir, name))
  .filter(existsSync);

if (manifests.length === 0) {
  throw new Error(
    "Bundle budget requires a completed Next.js production build (.next manifests missing).",
  );
}

const maxChunk = numberEnv("BUNDLE_MAX_CHUNK_BYTES", 350_000);
const maxRoute = numberEnv("BUNDLE_MAX_ROUTE_BYTES", 650_000);
const maxShared = numberEnv("BUNDLE_MAX_SHARED_BYTES", 800_000);
const files = new Map();
const routes = new Map();

for (const manifestPath of manifests) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  collectRouteMap(manifest.pages, "page");
  collectRouteMap(manifest.app, "app");
  collectRouteMap(
    manifest.rootMainFiles ? { __shared__: manifest.rootMainFiles } : undefined,
    "shared",
  );
}

function collectRouteMap(map, source) {
  if (!map || typeof map !== "object") return;
  for (const [route, entries] of Object.entries(map)) {
    if (!Array.isArray(entries)) continue;
    const js = [
      ...new Set(entries.filter((entry) => typeof entry === "string" && entry.endsWith(".js"))),
    ];
    let total = 0;
    for (const relative of js) {
      const absolute = join(nextDir, normalize(relative));
      if (!existsSync(absolute)) continue;
      const size = statSync(absolute).size;
      files.set(relative, size);
      total += size;
    }
    const key = `${source}:${route}`;
    routes.set(key, Math.max(routes.get(key) ?? 0, total));
  }
}

const oversizedChunks = [...files.entries()]
  .filter(([, size]) => size > maxChunk)
  .sort((a, b) => b[1] - a[1]);
const oversizedRoutes = [...routes.entries()]
  .filter(([route, size]) => (route.includes("__shared__") ? size > maxShared : size > maxRoute))
  .sort((a, b) => b[1] - a[1]);

if (oversizedChunks.length || oversizedRoutes.length) {
  const lines = ["Client bundle budget exceeded."];
  if (oversizedChunks.length) {
    lines.push("Chunks:", ...oversizedChunks.map(([name, size]) => `  ${bytes(size)}  ${name}`));
  }
  if (oversizedRoutes.length) {
    lines.push(
      "Routes/shared:",
      ...oversizedRoutes.map(([name, size]) => `  ${bytes(size)}  ${name}`),
    );
  }
  throw new Error(lines.join("\n"));
}

console.log(`Bundle budget ok: ${files.size} JS chunks, ${routes.size} route/shared entries.`);

function numberEnv(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return Math.trunc(value);
}
function bytes(value) {
  return `${(value / 1024).toFixed(1)} KiB`;
}
