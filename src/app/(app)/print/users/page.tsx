import { getLocale, getTranslations } from "next-intl/server";
import { PrintCell, PrintDocument, PrintTable } from "@/components/settings/print-document";
import { toLocaleDigits } from "@/lib/digits.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { readRoles } from "@/modules/settings/role-queries.ts";
import { readUsers } from "@/modules/settings/user-queries.ts";

/**
 * The access register, on paper.
 *
 * Who may do what is the one thing an audit asks for in writing, and without
 * this the only way to answer it is to read two screens aloud.
 *
 * Two tables, because the question has two halves: which accounts exist and
 * what each of them holds, then what each role actually grants. A list of role
 * *names* against accounts answers nothing on its own — «کارشناس پژوهش» is not
 * a permission — so the capabilities are printed underneath.
 */

export async function generateMetadata() {
  const t = await getTranslations("settings");
  return { title: t("users.title") };
}

export default async function PrintUsersPage() {
  /*
   * The same capability the screen behind it is guarded on, re-checked rather
   * than assumed: this is a route of its own, reachable by typing it, and it
   * prints every account in the institution with its standing beside it.
   */
  const viewer = await requireCapability("users.manage");

  const [userPage, roles, t, common, capability, locale] = await Promise.all([
    readUsers(viewer.tenantId, viewer.userId, viewer.tier, viewer.isTenantOwner, "", 1, {
      all: true,
    }),
    readRoles(viewer.tenantId, viewer.tier),
    getTranslations("settings"),
    getTranslations("common"),
    getTranslations("capability"),
    getLocale(),
  ]);

  const users = userPage.rows;

  /**
   * A permission in the words the office reads.
   *
   * The comment above says a list of role *names* answers nothing, because
   * «کارشناس پژوهش» is not a permission — and a list of `audit.view,
   * calendar.manage` answers just as little in an office where nobody reads
   * Latin. It was the same mistake one level down.
   *
   * The stored key is the fallback, not the display: a role granted a
   * permission this build has no wording for still has to print, and the key is
   * at least true. The role's own `key` column beside this is what an auditor
   * matches against the system.
   *
   * Withheld permissions are *not* filtered out here, unlike in the roles
   * dialog. This sheet is the access register an audit asks for, and it records
   * what a role holds rather than what is reachable today — leaving a granted
   * permission off an access register is the wrong direction to be wrong in.
   */
  const named = (key: string) => {
    const message = capability(`${key}.name`);
    return message.endsWith(`${key}.name`) ? key : message;
  };

  const digits = (value: number) => toLocaleDigits(String(value), locale);
  const separator = locale.toLowerCase().startsWith("fa") ? "، " : ", ";

  return (
    <PrintDocument
      tenantId={viewer.tenantId}
      title={t("users.title")}
      subject={`${digits(userPage.total)} ${t("users.userCount")}`}
      backTo="/settings/users"
      backLabel={common("back")}
    >
      <PrintTable
        head={[
          t("profile.name"),
          t("profile.username"),
          t("profile.email"),
          t("users.roles"),
          t("users.column.standing"),
        ]}
      >
        {users.map((account) => (
          <tr key={account.id}>
            <PrintCell>{account.name}</PrintCell>
            <PrintCell ltr>{account.username ?? "—"}</PrintCell>
            <PrintCell ltr>{account.email}</PrintCell>
            <PrintCell>
              {account.roleNames.length === 0
                ? t("users.noRoles")
                : account.roleNames.join(separator)}
            </PrintCell>
            {/*
             * The column an audit is actually asking after. A register that
             * listed a revoked account beside a working one, with only its roles
             * to tell them apart, would report that somebody who left in March
             * still holds nothing — true, and not the question.
             */}
            <PrintCell>{t(`users.standing.${account.standing}`)}</PrintCell>
          </tr>
        ))}
      </PrintTable>

      <section className="mt-8 break-inside-avoid">
        <h2 className="mb-2 text-base font-semibold">{t("roles.title")}</h2>
        <PrintTable head={[t("roles.name"), t("roles.key"), t("roles.capabilities")]}>
          {roles.map((role) => (
            <tr key={role.id}>
              <PrintCell>{role.name}</PrintCell>
              <PrintCell ltr>{role.key}</PrintCell>
              {/* Not `ltr`: these are Persian phrases now, and pinning the
                  cell left-to-right would set them against the sheet. */}
              <PrintCell>{role.capabilities.map(named).join(separator)}</PrintCell>
            </tr>
          ))}
        </PrintTable>
      </section>
    </PrintDocument>
  );
}
