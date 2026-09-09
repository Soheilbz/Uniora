import {
  PermanentOperationError,
  type PlatformRequestRow,
  record,
  textOrNull,
} from "./platform-operation-model.ts";

export async function assertPlatformRequesterAuthorized(
  pool: import("pg").Pool,
  row: PlatformRequestRow,
  defaultOperator: string,
  platformSessionHours: number,
): Promise<string> {
  const authMeta = record(row.payload.__auth);
  const sessionId = textOrNull(authMeta?.sessionId);
  const requestedAtRaw = textOrNull(authMeta?.requestedAt);
  const requestedAt = requestedAtRaw ? new Date(requestedAtRaw) : row.createdAt;
  if (!sessionId || Number.isNaN(requestedAt.getTime())) {
    throw new PermanentOperationError(
      "authorization_missing",
      "queue request has no valid auth proof",
    );
  }

  const { rows } = await pool.query<{ username: string | null }>(
    `select u.display_username as username
       from platform_operators p
       join "user" u on u.id=p.user_id
       join session s on s.id=$2 and s.user_id=p.user_id
      where p.user_id=$1
        and u.tenant_id is null
        and u.suspended_at is null
        and (u.account_expires_at is null or u.account_expires_at > now())
        and s.created_at > $4
        and s.expires_at > now()
        and s.mfa_verified_at is not null
        and s.mfa_verified_at <= $3
        and s.elevated_until is not null
        and s.elevated_until >= $3`,
    [
      row.requestedBy,
      sessionId,
      requestedAt,
      new Date(requestedAt.getTime() - platformSessionHours * 60 * 60 * 1000),
    ],
  );
  const authorized = rows[0];
  if (!authorized) {
    throw new PermanentOperationError(
      "authorization_revoked",
      "platform requester/session is no longer authorized",
    );
  }
  const username = authorized.username?.trim();
  return username
    ? `platform:${username}#${row.requestedBy.slice(0, 8)}`
    : `${defaultOperator}:${row.requestedBy.slice(0, 8)}`;
}
