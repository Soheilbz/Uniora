#!/usr/bin/env node

/* Development-only fail-closed scanner endpoint. Production must use ClamAV
 * or another approved antivirus service; this process is never enabled by a
 * production environment file. It catches the standard EICAR test signature
 * and returns a deterministic clean verdict for local test data. */
import { createServer } from "node:http";

const host = "127.0.0.1";
const port = Number(process.env.LOCAL_ANTIVIRUS_PORT || 9110);
const eicar = Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");

const server = createServer(async (request, response) => {
  if (request.method !== "POST") {
    response.writeHead(405, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "POST required" }));
    return;
  }
  try {
    const body = await readBody(request, 512 * 1024 * 1024);
    const infected = body.includes(eicar);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        clean: !infected,
        verdict: infected ? "infected" : "clean",
        detail: infected ? "EICAR test signature detected" : "local development scanner",
      }),
    );
  } catch (error) {
    response.writeHead(413, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        verdict: "error",
        detail: error instanceof Error ? error.message : "scan failed",
      }),
    );
  }
});

server.listen(port, host, () =>
  console.log(`local antivirus scanner listening on http://${host}:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => server.close(() => process.exit(0)));

function readBody(request, maxBytes) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let total = 0;
    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        request.destroy();
        reject(new Error("scanner request exceeds local safety limit"));
        return;
      }
      chunks.push(chunk);
    });
    request.once("end", () => resolveBody(Buffer.concat(chunks)));
    request.once("error", reject);
  });
}
