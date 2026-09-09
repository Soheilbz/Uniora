import { getLocale, getTranslations } from "next-intl/server";
import { type CapabilityChoice, RoleEditor } from "@/components/settings/role-editor";
import { CAPABILITIES, ROLE_TIERS, tierName } from "@/lib/capabilities.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { readRoles } from "@/modules/settings/role-queries.ts";
import { deleteRole, saveRole } from "@/modules/settings/roles.ts";

/**
 * Roles, and what each one lets its holders do.
 *
 * The capabilities are listed with a sentence apiece saying what granting one
 * actually permits. That is the substance of this screen: `students.view` is a
 * key, and «دیدن پرونده‌ی دانشجویان، شامل کد ملی» is what somebody is deciding.
 */

export async function generateMetadata() {
  const t = await getTranslations("settings");
  return { title: t("roles.title") };
}

/** Which heading each capability is filed under, as the reference groups them. */
const CAPABILITY_GROUP: Record<string, string> = {
  students: "registry",
  professors: "registry",
  council: "research",
  capacity: "research",
  worksheets: "research",
  workshops: "research",
  calendar: "research",
};

export default async function RolesPage() {
  const viewer = await requireCapability("roles.manage");

  const [list, t, capability, locale] = await Promise.all([
    readRoles(viewer.tenantId, viewer.tier),
    getTranslations("settings"),
    getTranslations("capability"),
    getLocale(),
  ]);

  const capabilities: CapabilityChoice[] = CAPABILITIES.map((key) => ({
    key,
    name: capability(`${key}.name`),
    what: capability(`${key}.what`),
    group: capability(`group.${CAPABILITY_GROUP[key.split(".")[0] ?? ""] ?? "system"}`),
    grantable: viewer.capabilities.includes(key),
  }));

  /* Strictly below the viewer's own tier — see the same rule in `saveRole`. */
  const tiers = ROLE_TIERS.slice(0, viewer.tier).map((_, rank) => ({
    value: String(rank),
    label: t(`users.tier.${tierName(rank)}`),
  }));

  const words: Record<string, string> = {
    title: t("roles.title"),
    add: t("roles.add"),
    newTitle: t("roles.newTitle"),
    editTitle: t("roles.editTitle"),
    deleteTitle: t("roles.deleteTitle", { name: "{name}" }),
    deleteBody: t("roles.deleteBody"),
    deleteBlocked: t("roles.deleteBlocked", { count: "{count}" }),
    dialogHint: t("roles.dialogHint"),
    name: t("roles.name"),
    key: t("roles.key"),
    keyLocked: t("roles.keyLocked"),
    tier: t("roles.tier"),
    tierHint: t("roles.tierHint"),
    capabilities: t("roles.capabilities"),
    capabilityCount: t("roles.capabilityCount"),
    allCapabilities: t("roles.allCapabilities"),
    holders: t("roles.holders", { count: "{count}" }),
    noHolders: t("roles.noHolders"),
    empty: t("roles.empty"),
    count: t("roles.count"),
    searchPlaceholder: t("roles.searchPlaceholder"),
    emptySearch: t("roles.emptySearch"),
    system: t("roles.system"),
    beyondYourLevel: t("roles.beyondYourLevel"),
    columnRole: t("roles.column.role"),
    columnAccess: t("roles.column.access"),
    columnHolders: t("roles.column.holders"),
    "tier.0": t("users.tier.ordinary"),
    "tier.1": t("users.tier.senior"),
    "tier.2": t("users.tier.administrator"),
    save: t("save"),
    saved: t("saved"),
    saveFailed: t("saveFailed"),
    cancel: t("cancel"),
    delete: t("delete"),
    duplicate: t("roles.duplicate"),
    setKeyInvalid: t("roles.keyInvalid"),
    required: t("error.required"),
    tooLong: t("error.tooLong"),
  };

  return (
    <RoleEditor
      roles={list}
      capabilities={capabilities}
      tiers={tiers}
      save={saveRole}
      remove={deleteRole}
      t={words}
      locale={locale}
    />
  );
}
