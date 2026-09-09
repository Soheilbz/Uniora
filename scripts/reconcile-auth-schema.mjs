import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runPnpm } from "./lib/run-command.mjs";

const root = resolve(import.meta.dirname, "..");
const expectedVersion = "1.7.3";
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
for (const name of [
  "better-auth",
  "@better-auth/passkey",
  "@better-auth/sso",
  "@better-auth/scim",
]) {
  const version = String(pkg.dependencies?.[name] ?? "");
  if (version !== expectedVersion)
    throw new Error(
      `Better Auth release train mismatch for ${name}: expected ${expectedVersion}, got ${version || "<missing>"}`,
    );
}

/* Generated reconciliation evidence is runtime state, not release source.
 * Keeping it under .univ prevents a successful or failed release audit from
 * leaving a forbidden artifact that contaminates source-package validation. */
const outputDir = join(root, ".univ", "runtime", "reports", "better-auth-schema");
const generated = join(outputDir, "generated.ts");
mkdirSync(outputDir, { recursive: true });
rmSync(generated, { force: true });
console.log(`Generating Better Auth Drizzle schema with pinned auth@${expectedVersion} CLI...`);
try {
  runPnpm(["exec", "auth", "generate", "--output", generated, "--yes"], {
    cwd: root,
    label: "Better Auth schema generation",
  });
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  throw new Error(
    `Better Auth schema generation could not execute the pinned official auth@ CLI (${detail}). ` +
      "Run the frozen dependency install to materialize the declared CLI; " +
      "the release audit must never substitute a locally invented schema.",
    { cause: error },
  );
}

const generatedText = readFileSync(generated, "utf8");
const enterpriseSchemaPath = join(root, "src", "db", "schema", "enterprise.ts");
const enterpriseText = readFileSync(enterpriseSchemaPath, "utf8");
const enterpriseScimSchemaPath = join(root, "src", "db", "schema", "enterprise-scim.ts");
const enterpriseScimText = readFileSync(enterpriseScimSchemaPath, "utf8");
const migrationPath = join(root, "drizzle", "0037_final_release_hardening.sql");
const migrationText = readFileSync(migrationPath, "utf8");
const authPath = join(root, "src", "lib", "auth.ts");
const authText = readFileSync(authPath, "utf8");

const contracts = {
  passkey: ["credentialID", "publicKey", "backedUp"],
  ssoProvider: ["providerId", "issuer", "domain"],
  scimConnectionBinding: [
    "connectionId",
    "connectionKey",
    "provisioningDomainId",
    "createdAt",
    "decommissionedAt",
    "decommissionStatus",
    "decommissionCursorUserId",
    "decommissionReconciledUserCount",
    "decommissionBatchCount",
    "decommissionRevision",
    "decommissionCompletedAt",
    "decommissionLeaseId",
    "decommissionLeaseExpiresAt",
  ],
  scimIdentityTombstone: [
    "connectionId",
    "provisioningDomainId",
    "externalId",
    "externalIdKey",
    "userId",
    "profile",
    "deletedAt",
  ],
  scimSubject: ["userId", "profileSourceId", "revision", "createdAt", "updatedAt"],
  scimUser: [
    "connectionId",
    "provisioningDomainId",
    "userId",
    "connectionUserKey",
    "userName",
    "userNameKey",
    "primaryEmail",
    "workEmailValueIndex",
    "emailValueIndex",
    "displayName",
    "formattedName",
    "givenName",
    "familyName",
    "serializedEmails",
    "serializedAttributes",
    "externalId",
    "externalIdKey",
    "active",
    "orderKey",
    "createdAt",
    "updatedAt",
  ],
  scimProjectionGrant: [
    "connectionId",
    "provisioningDomainId",
    "scimUserId",
    "userId",
    "sourceKind",
    "sourceId",
    "sourceValue",
    "role",
    "grantKey",
    "createdAt",
    "updatedAt",
  ],
  scimGroup: [
    "connectionId",
    "provisioningDomainId",
    "revision",
    "displayName",
    "displayNameKey",
    "externalId",
    "externalIdKey",
    "orderKey",
    "createdAt",
    "updatedAt",
  ],
  scimGroupMember: ["connectionId", "groupId", "scimUserId", "membershipKey", "createdAt"],
};

for (const [model, fields] of Object.entries(contracts)) {
  mustContain(
    generatedText,
    model,
    `Generated Better Auth schema is missing required model: ${model}`,
  );
  mustContain(
    model.startsWith("scim") ? enterpriseScimText : enterpriseText,
    `export const ${model}`,
    `Application schema is missing required Better Auth model: ${model}`,
  );
  mustContain(
    authText,
    `${model}: schema.${model}`,
    `Drizzle adapter schema is missing required Better Auth model binding: ${model}`,
  );
  for (const field of fields) {
    mustContain(
      generatedText,
      field,
      `Generated Better Auth model ${model} is missing required field: ${field}`,
    );
    mustContain(
      model.startsWith("scim") ? enterpriseScimText : enterpriseText,
      field,
      `Application model ${model} is missing required field: ${field}`,
    );
  }
}

for (const table of [
  "scim_connection_binding",
  "scim_identity_tombstone",
  "scim_subject",
  "scim_user",
  "scim_projection_grant",
  "scim_group",
  "scim_group_member",
]) {
  mustContain(
    migrationText,
    table,
    `Release migration is missing required Better Auth SCIM table: ${table}`,
  );
}

const report = join(outputDir, "README.txt");
writeFileSync(
  report,
  `Better Auth generated-schema reconciliation\nGenerated: ${new Date().toISOString()}\nCLI: auth@${expectedVersion}\nOutput: ${generated}\nLocal schema: ${enterpriseSchemaPath}, ${enterpriseScimSchemaPath}\nRelease migration: ${migrationPath}\n\nPASS means the pinned official CLI exposed every required Better Auth model/field, the checked-in Drizzle schema exposed the same compatibility contract, and all SCIM plugin tables were present in the release migration. This gate never applies a migration and never overwrites application source.\n`,
  "utf8",
);
console.log("Better Auth schema compatibility contract verified.");
console.log(`Reconciliation report: ${report}`);

function mustContain(text, token, message) {
  if (!text.includes(token)) throw new Error(message);
}
