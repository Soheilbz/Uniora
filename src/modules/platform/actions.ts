"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db/client.ts";
import { platformOperationRequests } from "@/db/schema.ts";
import { isValidLocalUsername, isValidTenantSlug } from "@/lib/auth-username.ts";
import { PASSWORD_MAXIMUM_LENGTH, PASSWORD_MINIMUM_LENGTH } from "@/lib/password-policy.ts";
import { encryptPlatformOperationSecret } from "@/lib/platform-operation-secret.ts";
import { requirePlatformElevatedSession } from "@/lib/platform-viewer.ts";
import { isUuid } from "@/lib/uuid.ts";
import { readTenantOwnerEligibility } from "./queries.ts";

const NAME_MAXIMUM_LENGTH = 160;

type PlatformOperationKind =
  | "tenant.create"
  | "tenant.rename"
  | "tenant.suspend"
  | "tenant.resume"
  | "tenant.archive"
  | "tenant.failed.purge"
  | "tenant.owner.set"
  | "tenant.user.password.reset"
  | "backup.create"
  | "backup.verify"
  | "break-glass.start"
  | "break-glass.end"
  | "platform.operation.retry"
  | "platform.operation.cancel";

async function enqueue(
  kind: PlatformOperationKind,
  payload: Record<string, unknown>,
  requestId: string,
  destination = "/platform",
) {
  if (!isUuid(requestId)) fail("invalidRequest");
  const operator = await requirePlatformElevatedSession("/platform");

  /*
   * The browser-rendered UUID is the idempotency key for that exact form
   * instance. Double clicks and browser retries carry the same UUID, so the
   * primary key turns them into one queue request without preventing a later,
   * intentional repeat after the page is rendered again with a new UUID.
   *
   * The bearer session that authorized the operation is recorded as internal
   * metadata. The privileged worker re-checks that it belonged to this operator
   * and was MFA-elevated when the request entered the queue.
   */
  await db()
    .insert(platformOperationRequests)
    .values({
      id: requestId,
      kind,
      payload: {
        ...payload,
        __auth: { sessionId: operator.sessionId, requestedAt: new Date().toISOString() },
      },
      requestedBy: operator.userId,
    })
    .onConflictDoNothing({ target: platformOperationRequests.id });
  revalidatePath("/platform");
  redirect(`${destination}?queued=${encodeURIComponent(kind)}`);
}

function value(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

function requestId(form: FormData): string {
  const id = value(form, "requestId");
  if (!isUuid(id)) fail("invalidRequest");
  return id;
}

function fail(code: string): never {
  redirect(`/platform?error=${encodeURIComponent(code)}`);
}

export async function requestTenantCreate(form: FormData) {
  const slug = value(form, "slug").toLowerCase();
  const name = value(form, "name");
  const managerName = value(form, "managerName");
  const managerUsername = value(form, "managerUsername").toLowerCase();
  const managerPassword = String(form.get("managerPassword") ?? "");

  if (!isValidTenantSlug(slug)) fail("invalidSlug");
  if (name.length === 0 || name.length > NAME_MAXIMUM_LENGTH) fail("invalidName");
  if (!isValidLocalUsername(managerUsername)) fail("invalidUsername");
  if (managerName.length === 0 || managerName.length > NAME_MAXIMUM_LENGTH) fail("invalidName");
  if (
    managerPassword.length < PASSWORD_MINIMUM_LENGTH ||
    managerPassword.length > PASSWORD_MAXIMUM_LENGTH
  ) {
    fail("invalidPassword");
  }

  await enqueue(
    "tenant.create",
    {
      slug,
      name,
      adminName: managerName,
      adminUsername: managerUsername,
      adminPassword: encryptPlatformOperationSecret(managerPassword),
    },
    requestId(form),
  );
}

export async function requestTenantRename(form: FormData) {
  const slug = value(form, "slug").toLowerCase();
  const name = value(form, "name");
  if (!isValidTenantSlug(slug)) fail("invalidSlug");
  if (name.length === 0 || name.length > NAME_MAXIMUM_LENGTH) fail("invalidName");
  await enqueue("tenant.rename", { slug, name }, requestId(form));
}

export async function requestTenantLifecycle(form: FormData) {
  const slug = value(form, "slug").toLowerCase();
  const action = value(form, "action") as Exclude<
    PlatformOperationKind,
    | "tenant.create"
    | "tenant.rename"
    | "tenant.owner.set"
    | "tenant.user.create"
    | "break-glass.start"
    | "break-glass.end"
  >;
  if (!isValidTenantSlug(slug)) fail("invalidSlug");
  if (!(action === "tenant.suspend" || action === "tenant.resume" || action === "tenant.archive")) {
    fail("invalidOperation");
  }
  if (action === "tenant.archive" && value(form, "confirmation") !== `ARCHIVE:${slug}`) {
    fail("confirmationRequired");
  }
  await enqueue(action, { slug }, requestId(form));
}

export async function requestTenantFailedProvisioningPurge(form: FormData) {
  const slug = value(form, "slug").toLowerCase();
  if (!isValidTenantSlug(slug)) fail("invalidSlug");
  if (value(form, "confirmation") !== `PURGE:${slug}`) fail("confirmationRequired");
  await enqueue("tenant.failed.purge", { slug }, requestId(form));
}

export async function requestBreakGlassStart(form: FormData) {
  const slug = value(form, "slug").toLowerCase();
  const reason = value(form, "reason");
  const durationMinutes = Number(value(form, "durationMinutes") || "30");
  const notifyTenant = form.get("notifyTenant") === "on";
  if (!isValidTenantSlug(slug)) fail("invalidSlug");
  if (reason.length < 10 || reason.length > 1000) fail("invalidReason");
  if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 30) {
    fail("invalidDuration");
  }
  await enqueue(
    "break-glass.start",
    { slug, reason, durationMinutes, notifyTenant },
    requestId(form),
  );
}

export async function requestBreakGlassEnd(form: FormData) {
  const breakGlassId = value(form, "breakGlassId");
  const slug = value(form, "slug").toLowerCase();
  if (!isUuid(breakGlassId)) fail("invalidRequest");
  if (!isValidTenantSlug(slug)) fail("invalidSlug");
  await enqueue("break-glass.end", { breakGlassId, slug }, requestId(form));
}

export async function requestTenantOwnerChange(form: FormData) {
  const slug = value(form, "slug").toLowerCase();
  const username = value(form, "username").toLowerCase();
  const reason = value(form, "reason");
  const confirmation = value(form, "confirmation");
  if (!isValidTenantSlug(slug)) fail("invalidSlug");
  if (!isValidLocalUsername(username)) fail("invalidUsername");
  if (reason.length < 10 || reason.length > 500) fail("invalidReason");
  if (confirmation !== `CHANGE-OWNER:${slug}:${username}`) fail("confirmationRequired");
  const eligibility = await readTenantOwnerEligibility(slug, username);
  if (eligibility === "tenant-not-found") fail("tenantNotFound");
  if (eligibility === "tenant-not-ready") fail("tenantNotReady");
  if (eligibility === "target-not-eligible") fail("ownerTargetNotEligible");
  await enqueue("tenant.owner.set", { slug, username, reason }, requestId(form));
}

export async function requestTenantUserPasswordReset(form: FormData) {
  const slug = value(form, "slug").toLowerCase();
  const username = value(form, "username").toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!isValidTenantSlug(slug)) fail("invalidSlug");
  if (!isValidLocalUsername(username)) fail("invalidUsername");
  if (password.length < PASSWORD_MINIMUM_LENGTH || password.length > PASSWORD_MAXIMUM_LENGTH) {
    fail("invalidPassword");
  }
  await enqueue(
    "tenant.user.password.reset",
    { slug, username, password: encryptPlatformOperationSecret(password) },
    requestId(form),
  );
}

export async function requestPlatformBackup(form: FormData) {
  const action = value(form, "action");
  if (action !== "create" && action !== "verify") fail("invalidOperation");
  await enqueue(`backup.${action}`, {}, requestId(form));
}

const RETRYABLE_PLATFORM_OPERATIONS = new Set([
  "tenant.rename",
  "tenant.suspend",
  "tenant.resume",
  "tenant.archive",
  "tenant.owner.set",
  "backup.create",
  "backup.verify",
]);

export async function requestPlatformOperationControl(form: FormData) {
  const targetOperationId = value(form, "operationId");
  const action = value(form, "action");
  if (!isUuid(targetOperationId)) fail("invalidRequest");
  if (action !== "retry" && action !== "cancel") fail("invalidOperation");
  const target = await db()
    .select({ kind: platformOperationRequests.kind, status: platformOperationRequests.status })
    .from(platformOperationRequests)
    .where(eq(platformOperationRequests.id, targetOperationId))
    .limit(1);
  const row = target[0];
  if (!row) fail("operationNotFound");
  if (action === "cancel" && row.status !== "queued") fail("operationNotQueued");
  if (
    action === "retry" &&
    (row.status !== "failed" || !RETRYABLE_PLATFORM_OPERATIONS.has(row.kind))
  ) {
    fail("operationNotRetryable");
  }
  const control = action === "retry" ? "platform.operation.retry" : "platform.operation.cancel";
  await enqueue(control, { targetOperationId }, requestId(form), "/platform/operations");
}
