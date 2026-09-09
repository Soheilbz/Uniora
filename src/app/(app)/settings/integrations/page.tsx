import { getFormatter, getTranslations } from "next-intl/server";
import { EnterpriseConnectionManager } from "@/components/engine/enterprise-connection-manager.tsx";
import { ScimCredentialManager } from "@/components/engine/scim-credential-manager.tsx";
import { SigningConnectionManager } from "@/components/engine/signing-connection-manager.tsx";
import { SystemSyncManager } from "@/components/engine/system-sync-manager.tsx";
import { WebhookManager } from "@/components/engine/webhook-manager.tsx";
import { requireCapability } from "@/lib/viewer.ts";
import {
  listEnterpriseConnections,
  listExternalIdentityLinks,
} from "@/modules/integrations/connections.ts";
import { listScimCredentials } from "@/modules/integrations/scim-credentials.ts";
import { listSigningConnections } from "@/modules/integrations/signing-connections.ts";
import { listSystemSyncState } from "@/modules/integrations/system-sync.ts";
import {
  listRecentWebhookDeliveries,
  listWebhookSubscriptions,
  WEBHOOK_EVENT_TYPES,
} from "@/modules/integrations/webhooks.ts";

export async function generateMetadata() {
  const t = await getTranslations("integrationSettings");
  return { title: t("title") };
}

export default async function IntegrationSettingsPage() {
  const viewer = await requireCapability("integrations.manage");
  const [
    t,
    format,
    subscriptions,
    deliveries,
    connections,
    signingConnections,
    identities,
    scimCredentials,
    systemSync,
  ] = await Promise.all([
    getTranslations("integrationSettings"),
    getFormatter(),
    listWebhookSubscriptions(viewer.tenantId),
    listRecentWebhookDeliveries(viewer.tenantId),
    listEnterpriseConnections(viewer.tenantId),
    listSigningConnections(viewer.tenantId),
    listExternalIdentityLinks(viewer.tenantId),
    listScimCredentials(viewer.tenantId),
    listSystemSyncState(viewer.tenantId),
  ]);
  const dateTime = (value: Date | null) =>
    value ? format.dateTime(value, { dateStyle: "medium", timeStyle: "short" }) : null;

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <EnterpriseConnectionManager
        identities={identities}
        connections={connections.map((item) => ({
          id: item.id,
          kind: item.kind,
          name: item.name,
          status: item.status,
          version: item.version,
          endpoint: item.endpoint,
          domain: item.domain,
          runtimeAvailable: item.runtimeAvailable,
          lastSyncAt: dateTime(item.lastSyncAt),
          lastError: item.lastError,
        }))}
        words={{
          title: t("connections.title"),
          description: t("connections.description"),
          newTitle: t("connections.newTitle"),
          kind: t("connections.kind"),
          name: t("connections.name"),
          endpoint: t("connections.endpoint"),
          identifier: t("connections.identifier"),
          secret: t("connections.secret"),
          domain: t("connections.domain"),
          baseDn: t("connections.baseDn"),
          usernameAttribute: t("connections.usernameAttribute"),
          metadata: t("connections.metadata"),
          metadataHint: t("connections.metadataHint"),
          create: t("connections.create"),
          active: t("connections.active"),
          disabled: t("connections.disabled"),
          runtimeReady: t("connections.runtimeReady"),
          runtimeMissing: t("connections.runtimeMissing"),
          enable: t("connections.enable"),
          disable: t("connections.disable"),
          retire: t("connections.retire"),
          protected: t("connections.protected"),
          noConnections: t("connections.noConnections"),
          identitiesTitle: t("connections.identitiesTitle"),
          identitiesDescription: t("connections.identitiesDescription"),
          identityConnection: t("connections.identityConnection"),
          identityUsername: t("connections.identityUsername"),
          identityIssuer: t("connections.identityIssuer"),
          identitySubject: t("connections.identitySubject"),
          provision: t("connections.provision"),
          noIdentities: t("connections.noIdentities"),
          identityRule: t("connections.identityRule"),
          kinds: {
            identity_oidc: t("connections.kinds.identity_oidc"),
            identity_saml: t("connections.kinds.identity_saml"),
            identity_ldap: t("connections.kinds.identity_ldap"),
            scim: t("connections.kinds.scim"),
          },
        }}
      />
      <SystemSyncManager
        state={{
          connections: systemSync.connections.map((item) => ({
            ...item,
            lastSyncAt: dateTime(item.lastSyncAt),
          })),
          runs: systemSync.runs.map((item) => ({
            ...item,
            startedAt: dateTime(item.startedAt),
            completedAt: dateTime(item.completedAt),
            createdAt: dateTime(item.createdAt) ?? "—",
          })),
          staging: systemSync.staging.map((item) => ({
            ...item,
            updatedAt: dateTime(item.updatedAt) ?? "—",
          })),
        }}
        words={{
          title: t("systemSync.title"),
          description: t("systemSync.description"),
          sync: t("systemSync.sync"),
          active: t("systemSync.active"),
          disabled: t("systemSync.disabled"),
          runs: t("systemSync.runs"),
          received: t("systemSync.received"),
          staged: t("systemSync.staged"),
          errors: t("systemSync.errors"),
          emptyRuns: t("systemSync.emptyRuns"),
          staging: t("systemSync.staging"),
          emptyStaging: t("systemSync.emptyStaging"),
          ignore: t("systemSync.ignore"),
          restore: t("systemSync.restore"),
        }}
      />
      <ScimCredentialManager
        connections={connections
          .filter((item) => item.kind === "scim" && item.status !== "retired")
          .map((item) => ({ id: item.id, name: item.name, status: item.status }))}
        credentials={scimCredentials.map((item) => ({
          ...item,
          expiresAt: dateTime(item.expiresAt),
          lastUsedAt: dateTime(item.lastUsedAt),
          createdAt: dateTime(item.createdAt) ?? "—",
          revokedAt: dateTime(item.revokedAt),
        }))}
        words={{
          title: t("scim.title"),
          description: t("scim.description"),
          newTitle: t("scim.newTitle"),
          connection: t("scim.connection"),
          scopes: t("scim.scopes"),
          expires: t("scim.expires"),
          create: t("scim.create"),
          tokenTitle: t("scim.tokenTitle"),
          tokenWarning: t("scim.tokenWarning"),
          copy: t("scim.copy"),
          active: t("scim.active"),
          revoked: t("scim.revoked"),
          rotate: t("scim.rotate"),
          revoke: t("scim.revoke"),
          lastUsed: t("scim.lastUsed"),
          never: t("scim.never"),
          empty: t("scim.empty"),
          error: t("scim.error"),
        }}
      />
      <SigningConnectionManager
        items={signingConnections.map((item) => ({
          id: item.id,
          name: item.name,
          status: item.status,
          version: item.version,
          endpoint: item.endpoint,
          providerName: item.providerName,
          mode: item.mode,
          keyId: item.keyId,
          lastError: item.lastError,
        }))}
        words={{
          title: t("signing.title"),
          description: t("signing.description"),
          name: t("signing.name"),
          endpoint: t("signing.endpoint"),
          provider: t("signing.provider"),
          token: t("signing.token"),
          keyId: t("signing.keyId"),
          mode: t("signing.mode"),
          detached: t("signing.detached"),
          pades: t("signing.pades"),
          create: t("signing.create"),
          active: t("active"),
          disabled: t("connections.disabled"),
          enable: t("connections.enable"),
          disable: t("connections.disable"),
          retire: t("connections.retire"),
          secret: t("signing.secret"),
          empty: t("signing.empty"),
        }}
      />
      <WebhookManager
        eventOptions={WEBHOOK_EVENT_TYPES.map((value) => ({ value, label: t(`events.${value}`) }))}
        subscriptions={subscriptions.map((item) => ({
          ...item,
          createdAt: dateTime(item.createdAt) ?? "—",
          updatedAt: dateTime(item.updatedAt) ?? "—",
        }))}
        deliveries={deliveries.map((item) => ({
          ...item,
          createdAt: dateTime(item.createdAt) ?? "—",
          nextAttemptAt: dateTime(item.nextAttemptAt),
          deliveredAt: dateTime(item.deliveredAt),
        }))}
        words={{
          newTitle: t("newTitle"),
          name: t("name"),
          endpoint: t("endpoint"),
          events: t("eventsTitle"),
          create: t("create"),
          secretTitle: t("secretTitle"),
          secretWarning: t("secretWarning"),
          copy: t("copy"),
          active: t("active"),
          paused: t("paused"),
          pause: t("pause"),
          resume: t("resume"),
          rotate: t("rotate"),
          disable: t("disable"),
          noSubscriptions: t("noSubscriptions"),
          deliveriesTitle: t("deliveriesTitle"),
          noDeliveries: t("noDeliveries"),
          delivery: t("delivery"),
          attempts: t("attempts"),
          response: t("response"),
          nextAttempt: t("nextAttempt"),
          deliveredAt: t("deliveredAt"),
          never: t("never"),
          invalid: t("errors.invalid"),
          stale: t("errors.stale"),
          failed: t("errors.failed"),
        }}
      />
    </div>
  );
}
