/** Low-cardinality structured process logging. Never pass tenant IDs, user IDs,
 * payloads, secrets, filesystem paths, or raw exceptions as fields. */
export function structuredLog(level, event, fields = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...sanitize(fields),
  };
  const line = JSON.stringify(payload);
  if (level === "error" || level === "warn") process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

function sanitize(fields) {
  const out = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) continue;
    if (value == null || typeof value === "boolean" || typeof value === "number") out[key] = value;
    else if (typeof value === "string" && value.length <= 160)
      out[key] = value.replace(/[\r\n]/g, " ");
  }
  return out;
}
