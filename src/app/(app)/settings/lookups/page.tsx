import { Printer } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { LookupEditor } from "@/components/settings/lookup-editor";
import { LookupSetSelector, SET_METADATA } from "@/components/settings/lookup-set-selector";
import { Button } from "@/components/ui/button";
import { CODE_OWNED, isClosedSet } from "@/db/vocabulary.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { readLookupEntries, readLookupSets } from "@/modules/settings/lookup-queries.ts";
import {
  addLookupEntry,
  moveLookupEntry,
  renameLookupEntry,
  setLookupRetired,
} from "@/modules/settings/lookups.ts";

/**
 * The institution's own vocabularies.
 *
 * Which set is open is in the address, like every other choice in this
 * application — so a colleague can be sent «the degrees list» rather than told
 * where to click.
 *
 * There is no "add a set". A set exists because code reads it: `degrees` is
 * what the student form offers and `weekdays` is what a sitting is filed under.
 * A control that created a seventh vocabulary nothing consults would be a
 * control that appears to work.
 */

export async function generateMetadata() {
  const t = await getTranslations("lookups");
  return { title: t("title") };
}

export default async function LookupsPage({
  searchParams,
}: {
  searchParams: Promise<{ set?: string | string[] }>;
}) {
  const viewer = await requireCapability("lookups.manage");

  const raw = (await searchParams).set;
  const asked = Array.isArray(raw) ? raw[0] : raw;

  const [sets, t, settings, common] = await Promise.all([
    readLookupSets(viewer.tenantId),
    getTranslations("lookups"),
    getTranslations("settings"),
    getTranslations("common"),
  ]);

  /* The asked-for set, checked against what exists — the value reaches a query,
     and the list of sets is the closed list to check it against. */
  const open = sets.find((one) => one.set === asked)?.set ?? sets[0]?.set ?? "";
  const entries = open === "" ? [] : await readLookupEntries(viewer.tenantId, open);

  const words: Record<string, string> = {
    label: t("label"),
    value: t("value"),
    valueHint: t("valueHint"),
    status: t("status"),
    sortOrder: t("sortOrder"),
    addValue: t("addValue"),
    editValue: t("editValue"),
    empty: t("empty"),
    setKeyInvalid: t("setKeyInvalid"),
    save: settings("save"),
    saved: settings("saved"),
    saveFailed: settings("saveFailed"),
    cancel: settings("cancel"),
    required: settings("error.required"),
    tooLong: settings("error.tooLong"),
    duplicate: t("duplicate"),
    offered: t("offered"),
    retired: t("retiredLabel"),
    retire: t("retire"),
    restore: t("restore"),
    moveUp: t("moveUp"),
    moveDown: t("moveDown"),
    codeOwned: t("codeOwned"),
    codeOwnedHint: t("codeOwnedHint"),
    valueRequiredBadge: t("valueRequiredBadge"),
    setClosed: t("setClosed"),
    valueRequired: t("valueRequired"),
    selectorLabel: t("selectorLabel"),
    setsCount: t("setsCount"),
    searchPlaceholder: t("searchPlaceholder"),
    emptySearch: t("emptySearch"),
    allSets: t("allSets"),
  };
  const selectorWords = {
    ...words,
    groupLabels: {
      educational: t("group.educational"),
      faculty: t("group.faculty"),
      research: t("group.research"),
      identity: t("group.identity"),
      other: t("group.other"),
    },
    setLabels: Object.fromEntries(
      Object.keys(SET_METADATA).map((key) => [key, t(`setLabel.${key}`)]),
    ),
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {/*
         * Every set at once, on paper. The screen shows one at a time — which
         * is right for editing — but the sheet an office marks up before a
         * revision is all of them, and printing eleven of them one screen at a
         * time is not a thing anybody does twice.
         *
         * A new tab, because the reader is in the middle of editing here.
         */}
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={
            <a href="/print/lookups" target="_blank" rel="noreferrer">
              <Printer className="size-4" aria-hidden />
              {common("print")}
            </a>
          }
        />
      </div>

      {/* Categorized and searchable Persian selector for vocabularies */}
      <LookupSetSelector sets={sets} open={open} t={selectorWords} />

      {open !== "" && (
        <LookupEditor
          set={open}
          entries={entries}
          add={addLookupEntry}
          rename={renameLookupEntry}
          retire={setLookupRetired}
          move={moveLookupEntry}
          closed={isClosedSet(open)}
          required={CODE_OWNED[open]?.required ?? []}
          t={words}
        />
      )}
    </div>
  );
}
