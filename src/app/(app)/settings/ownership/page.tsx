import { getTranslations } from "next-intl/server";
import { requireCapability } from "@/lib/viewer";
import { transferTenantOwnership } from "@/modules/settings/ownership";
import { readOwnershipCandidates } from "@/modules/settings/ownership-queries";
import { OwnershipForm } from "./ownership-form";

export async function generateMetadata() {
  const t = await getTranslations("settings.ownership");
  return { title: t("title") };
}

export default async function OwnershipPage() {
  const viewer = await requireCapability("users.manage", "roles.manage");
  const [candidates, t] = await Promise.all([
    readOwnershipCandidates(),
    getTranslations("settings.ownership"),
  ]);

  return (
    <OwnershipForm
      candidates={candidates}
      owner={viewer.isTenantOwner}
      action={transferTenantOwnership}
      t={{
        title: t("title"),
        subtitle: t("subtitle"),
        current: t("current"),
        transfer: t("transfer"),
        ownerOnly: t("ownerOnly"),
        newOwner: t("newOwner"),
        noCandidates: t("noCandidates"),
        confirmTitle: t("confirmTitle"),
        /* Keep the placeholder in the server-translated payload; the client
         * form replaces it with the selected candidate's display name. */
        confirmBody: t("confirmBody", { name: "{name}" }),
        confirmAction: t("confirmAction"),
        cancel: t("cancel"),
        invalidOwner: t("invalidOwner"),
        ownerTransferred: t("ownerTransferred"),
        saveFailed: t("saveFailed"),
      }}
    />
  );
}
