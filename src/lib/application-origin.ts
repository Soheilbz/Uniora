/** Canonical public application origin. Never derive public links from request Host headers. */
export function applicationOrigin(): string {
  const configured = process.env.BETTER_AUTH_URL?.trim();
  if (configured) {
    const url = new URL(configured);
    if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
      throw new Error("BETTER_AUTH_URL must be an origin");
    }
    return url.origin;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("BETTER_AUTH_URL is required in production");
  }
  return "http://localhost:3020";
}
