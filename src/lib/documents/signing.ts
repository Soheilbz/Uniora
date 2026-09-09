import { and, asc, eq, isNull } from "drizzle-orm";
import { integrationConnections } from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";
import { pinnedPublicHttpsRequest } from "@/lib/integrations/webhook-endpoint.ts";
import { decryptIntegrationSecret } from "@/lib/security/integration-secret.ts";
import type { DocumentSigningProvider, SignatureResult } from "./finalization.ts";

interface SigningConnectionConfig {
  endpoint: string;
  token: string;
  providerName: string;
  keyId?: string;
  mode: "detached" | "pades";
}

function parseConfig(raw: string): SigningConnectionConfig {
  const value = JSON.parse(decryptIntegrationSecret(raw)) as Partial<SigningConnectionConfig>;
  if (!value.endpoint || !value.token || !value.providerName)
    throw new Error("signing connection is incomplete");
  return {
    endpoint: value.endpoint,
    token: value.token,
    providerName: value.providerName.slice(0, 100),
    mode: value.mode === "pades" ? "pades" : "detached",
    ...(value.keyId ? { keyId: value.keyId.slice(0, 200) } : {}),
  };
}

class HttpDocumentSigningProvider implements DocumentSigningProvider {
  private readonly config: SigningConnectionConfig;

  constructor(config: SigningConnectionConfig) {
    this.config = config;
  }

  async sign(input: {
    tenantId: string;
    documentType: string;
    documentId: string;
    content: Uint8Array;
    sha256: string;
    mimeType: string;
  }): Promise<SignatureResult> {
    const requestBody = JSON.stringify({
      documentType: input.documentType,
      documentId: input.documentId,
      sha256: input.sha256,
      mimeType: input.mimeType,
      mode: this.config.mode,
      keyId: this.config.keyId ?? null,
      contentBase64: Buffer.from(input.content).toString("base64"),
    });
    const response = await pinnedPublicHttpsRequest(this.config.endpoint, {
      method: "POST",
      timeoutMs: 20_000,
      maxResponseBytes: 85_000_000,
      headers: {
        authorization: `Bearer ${this.config.token}`,
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(requestBody)),
        "user-agent": "univ-web-signing/1",
      },
      body: requestBody,
    });
    if (!response.ok) throw new Error(`signing provider refused the request (${response.status})`);
    let payload: {
      reference?: unknown;
      contentSha256?: unknown;
      signedContentBase64?: unknown;
      signedMimeType?: unknown;
    };
    try {
      payload = JSON.parse(Buffer.from(response.body).toString("utf8")) as typeof payload;
    } catch {
      throw new Error("signing provider returned invalid JSON");
    }
    const reference =
      typeof payload.reference === "string" ? payload.reference.trim().slice(0, 500) : "";
    if (!reference) throw new Error("signing provider returned no signature reference");
    const signedContentBase64 =
      typeof payload.signedContentBase64 === "string" ? payload.signedContentBase64 : "";
    if (signedContentBase64.length > 84_000_000)
      throw new Error("signing provider returned an oversized document");
    const signedContent =
      signedContentBase64.length > 0
        ? new Uint8Array(Buffer.from(signedContentBase64, "base64"))
        : undefined;
    if (signedContent && signedContent.byteLength > 60_000_000)
      throw new Error("signing provider returned an oversized document");
    if (this.config.mode === "pades" && !signedContent)
      throw new Error("PAdES signing provider returned no signed document");
    return {
      provider: this.config.providerName,
      reference,
      contentSha256:
        typeof payload.contentSha256 === "string" ? payload.contentSha256 : input.sha256,
      ...(signedContent ? { signedContent } : {}),
      ...(typeof payload.signedMimeType === "string" || signedContent
        ? {
            signedMimeType:
              typeof payload.signedMimeType === "string"
                ? payload.signedMimeType
                : "application/pdf",
          }
        : {}),
    };
  }
}

export async function resolveDocumentSigningProvider(
  tenantId: string,
): Promise<DocumentSigningProvider | null> {
  const [row] = await readOnly(tenantId, (tx) =>
    tx
      .select({ configEncrypted: integrationConnections.configEncrypted })
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.kind, "signing"),
          eq(integrationConnections.status, "active"),
          isNull(integrationConnections.deletedAt),
        ),
      )
      .orderBy(asc(integrationConnections.createdAt))
      .limit(1),
  );
  return row ? new HttpDocumentSigningProvider(parseConfig(row.configEncrypted)) : null;
}
