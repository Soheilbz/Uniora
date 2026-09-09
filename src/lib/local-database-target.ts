export type LocalDatabaseTarget = {
  name: string;
  role: string;
  url: string | undefined;
};

type ParsedTarget = {
  name: string;
  identity: string;
  display: string;
};

/**
 * Validate the one-database contract used by local bootstrap.
 *
 * Migration/setup runs with the owner URL while seed and the long-running
 * processes use the restricted URLs. They must name the same endpoint,
 * database and TLS mode; otherwise a successful migration can be followed by
 * a seed or runtime process talking to a different PostgreSQL cluster. The
 * comparison deliberately excludes passwords, which are expected to differ by
 * role and are never included in an error message.
 */
export function assertCanonicalLocalDatabaseTargets(
  values: readonly LocalDatabaseTarget[],
): string {
  const parsed: ParsedTarget[] = values.map(({ name, role, url: value }) => {
    const raw = value?.trim();
    if (!raw) throw new Error(`${name} is required for the canonical local database target.`);

    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error(`${name} must be a valid PostgreSQL URL.`);
    }
    if (!(["postgres:", "postgresql:"] as string[]).includes(url.protocol)) {
      throw new Error(`${name} must use the postgres or postgresql scheme.`);
    }
    if (!url.username || !url.password || !url.hostname || !url.pathname || url.pathname === "/") {
      throw new Error(`${name} must include host, role, password and database name.`);
    }
    if (decodeURIComponent(url.username) !== role) {
      throw new Error(`${name} must use the canonical ${role} role.`);
    }

    const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
    const port = url.port || "5432";
    const sslmode = url.searchParams.get("sslmode") || "prefer";
    return {
      name,
      identity: `${url.hostname.toLowerCase()}|${port}|${database}|${sslmode}`,
      display: `${url.hostname}:${port}/${database} (sslmode=${sslmode})`,
    };
  });

  const [first, ...rest] = parsed;
  if (!first) throw new Error("No canonical local database target was provided.");
  const mismatch = rest.find((target) => target.identity !== first.identity);
  if (mismatch) {
    throw new Error(
      `Local database split-brain refused: ${mismatch.name} targets ${mismatch.display}, while ${first.name} targets ${first.display}. ` +
        "Point every database URL at the same PostgreSQL endpoint and database before bootstrapping.",
    );
  }
  return first.display;
}
