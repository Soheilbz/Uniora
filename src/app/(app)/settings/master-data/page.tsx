import { CalendarRange, GraduationCap, History, Network } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { MasterDataCalendarTab } from "@/components/settings/master-data/calendar-tab";
import { MasterDataHistoryTab } from "@/components/settings/master-data/history-tab";
import { MasterDataOrganizationTab } from "@/components/settings/master-data/organization-tab";
import { MasterDataProgramsTab } from "@/components/settings/master-data/programs-tab";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireCapability } from "@/lib/viewer";
import { readMasterData } from "@/modules/master-data/queries";

export async function generateMetadata() {
  const t = await getTranslations("masterData");
  return { title: t("title") };
}

export default async function MasterDataPage() {
  const viewer = await requireCapability("master-data.manage");
  const [t, data] = await Promise.all([
    getTranslations("masterData"),
    readMasterData(viewer.tenantId),
  ]);
  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <Tabs defaultValue="calendar">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="calendar">
            <CalendarRange className="size-4" aria-hidden />
            {t("tabs.calendar")}
          </TabsTrigger>
          <TabsTrigger value="organization">
            <Network className="size-4" aria-hidden />
            {t("tabs.organization")}
          </TabsTrigger>
          <TabsTrigger value="programs">
            <GraduationCap className="size-4" aria-hidden />
            {t("tabs.programs")}
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="size-4" aria-hidden />
            {t("tabs.history")}
          </TabsTrigger>
        </TabsList>
        <MasterDataCalendarTab data={data} />
        <MasterDataOrganizationTab data={data} />
        <MasterDataProgramsTab data={data} />
        <MasterDataHistoryTab data={data} />
      </Tabs>
    </div>
  );
}
