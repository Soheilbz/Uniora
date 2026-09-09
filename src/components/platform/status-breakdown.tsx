import { Building2, CheckCircle2, CircleAlert, Clock3, ShieldAlert } from "lucide-react";
import { OperationalCard } from "@/components/platform/operational-card";

export function PlatformStatusBreakdown({
  title,
  lifecycleSummary,
  last24Hours,
  labels,
  counts,
}: {
  title: string;
  lifecycleSummary: string;
  last24Hours: string;
  labels: {
    suspended: string;
    provisioning: string;
    failedProvisioning: string;
    archived: string;
    successful: string;
    failed: string;
  };
  counts: {
    suspended: number;
    provisioning: number;
    failedProvisioning: number;
    archived: number;
    successful: number;
    failed: number;
  };
}) {
  return (
    <section aria-label={title} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
      <OperationalCard
        label={labels.suspended}
        value={String(counts.suspended)}
        detail={lifecycleSummary}
        icon={<ShieldAlert className="size-4" aria-hidden />}
        alert={counts.suspended > 0}
      />
      <OperationalCard
        label={labels.provisioning}
        value={String(counts.provisioning)}
        detail={lifecycleSummary}
        icon={<Clock3 className="size-4" aria-hidden />}
        alert={counts.provisioning > 0}
      />
      <OperationalCard
        label={labels.failedProvisioning}
        value={String(counts.failedProvisioning)}
        detail={lifecycleSummary}
        icon={<CircleAlert className="size-4" aria-hidden />}
        alert={counts.failedProvisioning > 0}
      />
      <OperationalCard
        label={labels.archived}
        value={String(counts.archived)}
        detail={lifecycleSummary}
        icon={<Building2 className="size-4" aria-hidden />}
      />
      <OperationalCard
        label={labels.successful}
        value={String(counts.successful)}
        detail={last24Hours}
        icon={<CheckCircle2 className="size-4" aria-hidden />}
      />
      <OperationalCard
        label={labels.failed}
        value={String(counts.failed)}
        detail={last24Hours}
        icon={<CircleAlert className="size-4" aria-hidden />}
        alert={counts.failed > 0}
      />
    </section>
  );
}
