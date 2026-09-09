import net from "node:net";

export function portIsBound(port) {
  return new Promise((resolveBound) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (bound) => {
      socket.destroy();
      resolveBound(bound);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(500, () => finish(false));
  });
}
