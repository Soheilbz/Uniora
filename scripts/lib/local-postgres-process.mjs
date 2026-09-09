import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export function spawnLocalPostgres(binary, dataDirectory, port, logHandle) {
  /* A project-local cluster must not depend on a system-wide PostgreSQL socket
   * directory. The caller has already verified that this exact configured port
   * is available; keeping the socket private prevents accidental cross-cluster
   * connections if a system service is later enabled. */
  const socketDirectory = join(dataDirectory, ".sockets");
  mkdirSync(socketDirectory, { recursive: true, mode: 0o700 });
  return spawn(
    binary,
    [
      "-D",
      dataDirectory,
      "-p",
      port,
      "-c",
      "listen_addresses=127.0.0.1",
      "-c",
      `unix_socket_directories=${socketDirectory}`,
      "-c",
      "shared_preload_libraries=pg_stat_statements",
    ],
    { detached: true, stdio: ["ignore", logHandle, logHandle] },
  );
}
