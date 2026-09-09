import net, { type Server } from "node:net";

const DEFAULT_START = 3020;
const DEFAULT_END = 3120;

export interface FreePortOptions {
  preferred?: number;
  start?: number;
  end?: number;
  host?: string;
  used?: Set<number>;
}

function listenOnce(port: number, host: string): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (cause: Error) => {
      server.close(() => reject(cause));
    });
    server.listen({ port, host, ipv6Only: host === "::" }, () => {
      const address = server.address();
      const selected = typeof address === "object" && address ? address.port : port;
      resolve({ server, port: selected });
    });
  });
}

async function canListen(port: number, host = "::"): Promise<number> {
  const hosts = host === "::" ? ["::", "127.0.0.1"] : [host];
  const reservations: Server[] = [];
  let selectedPort = port;
  try {
    for (const candidateHost of hosts) {
      const reservation = await listenOnce(selectedPort, candidateHost);
      reservations.push(reservation.server);
      selectedPort = reservation.port;
    }
    return selectedPort;
  } finally {
    await Promise.all(
      reservations.map(
        (server) =>
          new Promise<void>((resolveClose) => {
            server.close(() => resolveClose());
          }),
      ),
    );
  }
}

export async function findFreePort({
  preferred = DEFAULT_START,
  start = DEFAULT_START,
  end = DEFAULT_END,
  host = "::",
  used = new Set<number>(),
}: FreePortOptions = {}): Promise<number> {
  const first = Number.isInteger(preferred) && preferred > 0 ? preferred : start;
  const last = Math.max(first, end);
  for (let port = first; port <= last; port += 1) {
    if (used.has(port)) continue;
    try {
      const selected = await canListen(port, host);
      used.add(selected);
      return selected;
    } catch {
      // occupied, reserved, or unavailable: try the next candidate
    }
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const selected = await canListen(0, host);
      if (!used.has(selected)) {
        used.add(selected);
        return selected;
      }
    } catch {
      // retry an OS-assigned port if the short reservation raced
    }
  }
  throw new Error(`No free web port found on ${host}.`);
}

export async function findFreePorts(
  count: number,
  options: FreePortOptions = {},
): Promise<number[]> {
  const used = new Set(options.used ?? []);
  const ports: number[] = [];
  for (let index = 0; index < count; index += 1) {
    ports.push(
      await findFreePort({
        ...options,
        preferred: Number(options.preferred ?? DEFAULT_START) + index,
        used,
      }),
    );
  }
  return ports;
}

export const DEFAULT_WEB_PORT = DEFAULT_START;
