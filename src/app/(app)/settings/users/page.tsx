import { getLocale, getTranslations } from "next-intl/server";
import { UserDirectory } from "@/components/settings/user-directory";
import { MAX_SEARCH_LENGTH } from "@/lib/input-limits.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { assignRoles, createUser, resetPassword } from "@/modules/settings/user-provisioning.ts";
import { readAssignableRoles, readUsers } from "@/modules/settings/user-queries.ts";
import {
  reinstateUser,
  revokeUser,
  signOutUser,
  suspendUser,
  updateUserLifecycle,
} from "@/modules/settings/users.ts";

/**
 * Who may sign in, and what each of them holds.
 *
 * Every control on a row is gated on the tier rule — see `users.ts` for why
 * `users.manage` without one is a privilege-escalation route. The screen greys
 * the controls out; the actions refuse the request.
 */

export async function generateMetadata() {
  const t = await getTranslations("settings");
  return { title: t("users.title") };
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; p?: string | string[] }>;
}) {
  const viewer = await requireCapability("users.manage");

  const params = await searchParams;
  const raw = params.q;
  const search = (Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "")).slice(0, MAX_SEARCH_LENGTH);
  const rawPage = Array.isArray(params.p) ? params.p[0] : params.p;
  const page = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);

  const [userPage, roles, t, common, locale] = await Promise.all([
    readUsers(viewer.tenantId, viewer.userId, viewer.tier, viewer.isTenantOwner, search, page),
    readAssignableRoles(viewer.tenantId, viewer.tier, viewer.isTenantOwner),
    getTranslations("settings"),
    getTranslations("common"),
    getLocale(),
  ]);

  const words: Record<string, string> = {
    title: t("users.title"),
    userCount: t("users.count", { count: "{count}" }),
    add: t("users.add"),
    print: common("print"),
    addHint: t("users.addHint"),
    empty: t("users.empty"),
    searchPlaceholder: t("users.searchPlaceholder"),
    fullName: t("users.fullName"),
    username: t("profile.username"),
    password: t("profile.newPassword"),
    newPassword: t("profile.newPassword"),
    passwordHint: t("users.passwordHint", { count: viewer.tenantPasswordMinLength }),
    resetHint: t("users.resetHint", { count: viewer.tenantPasswordMinLength }),
    resetPassword: t("users.resetPassword"),
    passwordReset: t("users.passwordReset"),
    passwordTooShort: t("users.passwordTooShort", { count: viewer.tenantPasswordMinLength }),
    passwordTooLong: t("users.passwordTooLong"),
    usernameInvalid: t("users.usernameInvalid"),
    usernameTaken: t("users.usernameTaken"),
    roles: t("users.roles"),
    noRoles: t("users.noRoles"),
    rolesRequired: t("users.rolesRequired"),
    assignRoles: t("users.assignRoles"),
    beyondYourLevel: t("users.beyondYourLevel"),
    outranksYou: t("users.outranksYou"),
    selfHint: t("users.selfHint"),
    devices: t("users.devices", { count: "{count}" }),
    noDevices: t("users.noDevices"),
    columnLastLogin: t("users.column.lastLogin"),
    neverLoggedIn: t("users.neverLoggedIn"),
    signOut: t("users.signOut"),
    signOutTitle: t("users.signOutTitle", { name: "{name}" }),
    signOutBody: t("users.signOutBody", { count: "{count}" }),
    signedOut: t("users.signedOut"),
    suspend: t("users.suspend"),
    suspendTitle: t("users.suspendTitle", { name: "{name}" }),
    suspendBody: t("users.suspendBody", { count: "{count}" }),
    suspendReason: t("users.suspendReason"),
    suspendReasonHint: t("users.suspendReasonHint"),
    suspended: t("users.suspended"),
    suspendedNoReason: t("users.suspendedNoReason"),
    reinstate: t("users.reinstate"),
    reinstateTitle: t("users.reinstateTitle", { name: "{name}" }),
    reinstateBody: t("users.reinstateBody"),
    reinstated: t("users.reinstated"),
    revoke: t("users.revoke"),
    revokeTitle: t("users.revokeTitle"),
    revokeBody: t("users.revokeBody", { name: "{name}" }),
    revokeVsSuspend: t("users.revokeVsSuspend"),
    revoked: t("users.revoked"),
    accountRevoked: t("users.accountRevoked"),
    accountStateChanged: t("users.accountStateChanged"),
    revokedNote: t("users.revokedNote"),
    "standing.active": t("users.standing.active"),
    "standing.scheduled": t("users.standing.scheduled"),
    "standing.suspended": t("users.standing.suspended"),
    "standing.expired": t("users.standing.expired"),
    "standing.revoked": t("users.standing.revoked"),
    lifecycle: t("users.lifecycle"),
    employmentStart: t("users.employmentStart"),
    employmentEnd: t("users.employmentEnd"),
    accountExpiry: t("users.accountExpiry"),
    accountExpiryHint: t("users.accountExpiryHint"),
    lifecycleSaved: t("users.lifecycleSaved"),
    invalidDate: t("users.invalidDate"),
    dateOrder: t("users.dateOrder"),
    columnAccount: t("users.column.account"),
    columnAccess: t("users.column.access"),
    columnStanding: t("users.column.standing"),
    columnDevices: t("users.column.devices"),
    editUser: t("users.editUser"),
    save: t("save"),
    saved: t("saved"),
    saveFailed: t("saveFailed"),
    cancel: t("cancel"),
    required: t("error.required"),
    tooLong: t("error.tooLong"),
  };

  return (
    <UserDirectory
      users={userPage.rows}
      totalUsers={userPage.total}
      roles={roles}
      actions={{
        create: createUser,
        assignRoles,
        suspend: suspendUser,
        reinstate: reinstateUser,
        revoke: revokeUser,
        signOut: signOutUser,
        resetPassword,
        lifecycle: updateUserLifecycle,
      }}
      t={words}
      locale={locale}
      timeZone={viewer.tenantTimezone}
      passwordMinLength={viewer.tenantPasswordMinLength}
      initialSearch={search}
    />
  );
}
