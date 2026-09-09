import { getFormatter, getTranslations } from "next-intl/server";
import { ServiceAccountManager } from "@/components/engine/service-account-manager.tsx";
import { requireCapability } from "@/lib/viewer.ts";
import {
  listServiceAccounts,
  SERVICE_ACCOUNT_CAPABILITIES,
} from "@/modules/integrations/service-accounts.ts";

export async function generateMetadata() {
  const t = await getTranslations("apiSettings");
  return { title: t("title") };
}

function parseCapabilities(raw: string): string[] {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export default async function ApiSettingsPage() {
  const viewer = await requireCapability("api.manage");
  const [t, capabilityT, format, accounts] = await Promise.all([
    getTranslations("apiSettings"),
    getTranslations("capability"),
    getFormatter(),
    listServiceAccounts(viewer.tenantId),
  ]);
  const allowed = SERVICE_ACCOUNT_CAPABILITIES.filter((capability) =>
    viewer.capabilities.includes(capability),
  );

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <ServiceAccountManager
        capabilityOptions={allowed.map((value) => ({ value, label: capabilityT(`${value}.name`) }))}
        accounts={accounts.map((account) => ({
          ...account,
          capabilities: parseCapabilities(account.capabilities),
          createdAt: format.dateTime(account.createdAt, {
            dateStyle: "medium",
            timeStyle: "short",
          }),
          expiresAt: account.expiresAt
            ? format.dateTime(account.expiresAt, { dateStyle: "medium" })
            : null,
          lastUsedAt: account.lastUsedAt
            ? format.dateTime(account.lastUsedAt, { dateStyle: "medium", timeStyle: "short" })
            : null,
          rotatedAt: account.rotatedAt
            ? format.dateTime(account.rotatedAt, { dateStyle: "medium", timeStyle: "short" })
            : null,
        }))}
        words={{
          newTitle: t("newTitle"),
          name: t("name"),
          description: t("description"),
          scopes: t("scopes"),
          rateLimit: t("rateLimit"),
          expiresOn: t("expiresOn"),
          create: t("create"),
          tokenTitle: t("tokenTitle"),
          tokenWarning: t("tokenWarning"),
          copy: t("copy"),
          active: t("active"),
          suspended: t("suspended"),
          suspend: t("suspend"),
          resume: t("resume"),
          rotate: t("rotate"),
          revoke: t("revoke"),
          prefix: t("prefix"),
          lastUsed: t("lastUsed"),
          never: t("never"),
          expires: t("expires"),
          noExpiry: t("noExpiry"),
          invalid: t("errors.invalid"),
          stale: t("errors.stale"),
          failed: t("errors.failed"),
        }}
      />
    </div>
  );
}
