#!/usr/bin/env node

/*
 * Development-only S3-compatible object store.
 *
 * It exists so a fresh local checkout exercises the same ObjectStorage
 * contract as production without silently turning local disk into a
 * production storage provider. The server is bound to loopback and all data
 * lives below .univ/runtime, which is ignored and disposable.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", ".univ", "runtime", "object-storage");
const host = "127.0.0.1";
const port = Number(process.env.LOCAL_OBJECT_STORAGE_PORT || 9100);
const browserOrigin = process.env.LOCAL_OBJECT_STORAGE_BROWSER_ORIGIN || "http://127.0.0.1:3020";
mkdirSync(root, { recursive: true, mode: 0o700 });

const server = createServer(async (request, response) => {
  setCommonHeaders(response);
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }
  try {
    const target = parseTarget(request.url);
    if (!target) return send(response, 400, { error: "invalid object path" });
    const file = objectFile(target.bucket, target.key);
    const meta = `${file}.meta.json`;

    if (request.headers["x-amz-copy-source"] && request.method === "PUT") {
      const source = parseCopySource(String(request.headers["x-amz-copy-source"]));
      if (!source) return send(response, 400, { error: "invalid copy source" });
      const sourceFile = objectFile(source.bucket, source.key);
      if (!exists(sourceFile)) return send(response, 404, { error: "source not found" });
      const sourceBytes = readFileSync(sourceFile);
      const sourceEtag = md5(sourceBytes);
      const expected = String(request.headers["x-amz-copy-source-if-match"] || "").replaceAll(
        '"',
        "",
      );
      if (expected && expected !== sourceEtag)
        return send(response, 412, { error: "etag mismatch" });
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      writeFileSync(file, sourceBytes, { mode: 0o600 });
      writeMeta(meta, readMeta(`${sourceFile}.meta.json`));
      response.setHeader("etag", `"${sourceEtag}"`);
      response.writeHead(200, { "content-type": "application/xml" });
      response.end("<CopyObjectResult/>\n");
      return;
    }

    if (request.method === "PUT") {
      const body = await readBody(request, 512 * 1024 * 1024);
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      writeFileSync(file, body, { mode: 0o600 });
      writeMeta(meta, {
        contentType: request.headers["content-type"] || "application/octet-stream",
      });
      response.setHeader("etag", `"${md5(body)}"`);
      response.writeHead(200);
      response.end();
      return;
    }

    if (request.method === "HEAD" || request.method === "GET") {
      if (!exists(file)) return send(response, 404, { error: "not found" });
      const bytes = readFileSync(file);
      const metadata = readMeta(meta);
      response.setHeader("content-length", String(bytes.length));
      response.setHeader("content-type", metadata.contentType || "application/octet-stream");
      response.setHeader("etag", `"${md5(bytes)}"`);
      response.writeHead(200);
      if (request.method === "GET") response.end(bytes);
      else response.end();
      return;
    }

    if (request.method === "DELETE") {
      if (exists(file)) unlinkSync(file);
      if (exists(meta)) unlinkSync(meta);
      response.writeHead(204);
      response.end();
      return;
    }
    send(response, 405, { error: "method not allowed" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "storage error";
    send(response, 500, { error: message.slice(0, 200) });
  }
});

server.listen(port, host, () => {
  console.log(
    `local object storage listening on http://${host}:${port} (browser: ${browserOrigin})`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => server.close(() => process.exit(0)));
}

function parseTarget(raw) {
  const url = new URL(raw || "/", `http://${host}:${port}`);
  const parts = url.pathname
    .split("/")
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));
  if (parts.length < 2) return null;
  const [bucket, ...key] = parts;
  if (!safePart(bucket) || key.length === 0 || key.some((part) => !safePart(part))) return null;
  return { bucket, key };
}

function parseCopySource(value) {
  const normalized = value.replace(/^\/+/, "");
  const parts = normalized.split("/").map((part) => decodeURIComponent(part));
  if (parts.length < 2) return null;
  const [bucket, ...key] = parts;
  if (!safePart(bucket) || key.length === 0 || key.some((part) => !safePart(part))) return null;
  return { bucket, key };
}

function objectFile(bucket, key) {
  const candidate = resolve(root, bucket, ...key);
  const rootWithSep = `${root}${relative(root, root).includes("\\") ? "\\" : "/"}`;
  if (candidate !== resolve(root) && !candidate.startsWith(rootWithSep))
    throw new Error("unsafe object path");
  return candidate;
}

function safePart(value) {
  return Boolean(value) && value !== "." && value !== ".." && !/[\\/\0]/u.test(value);
}

function exists(path) {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function readMeta(path) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return typeof value === "object" && value ? value : {};
  } catch {
    return {};
  }
}

function writeMeta(path, value) {
  writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

function md5(bytes) {
  return createHash("md5").update(bytes).digest("hex");
}

function readBody(request, maxBytes) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let total = 0;
    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        request.destroy();
        reject(new Error("request exceeds local object-storage limit"));
        return;
      }
      chunks.push(chunk);
    });
    request.once("end", () => resolveBody(Buffer.concat(chunks)));
    request.once("error", reject);
  });
}

function setCommonHeaders(response) {
  response.setHeader("access-control-allow-origin", browserOrigin);
  response.setHeader("access-control-allow-methods", "GET,HEAD,PUT,DELETE,OPTIONS");
  response.setHeader(
    "access-control-allow-headers",
    "content-type,authorization,x-amz-date,x-amz-content-sha256,x-amz-copy-source,x-amz-copy-source-if-match",
  );
  response.setHeader("access-control-expose-headers", "etag,content-length,content-type");
}

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
