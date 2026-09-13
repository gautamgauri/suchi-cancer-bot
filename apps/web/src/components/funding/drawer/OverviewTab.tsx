import { useTranslation } from "react-i18next";
import type { PipelineEntry } from "../../../services/fundingApi";
import { TopBanner } from "../TopBanner";

interface OverviewTabProps {
  entry: PipelineEntry;
  compact?: boolean;
}

export function OverviewTab({ entry, compact = false }: OverviewTabProps) {
  const { t } = useTranslation("funding");
  const p = compact ? "p-2" : "p-4";

  const copyNotes = () => {
    if (entry.notes) navigator.clipboard.writeText(entry.notes);
  };

  return (
    <div className={p}>
      <TopBanner
        message={t("drawer.localOnlyBanner")}
        dismissible
        storageKey="funding_local_edit_banner"
        className="mb-4"
      />
      <dl className="space-y-3 text-sm">
        <Row label={t("pipeline.orgName")} value={entry.orgName} />
        <Row label={t("pipeline.stage")} value={entry.stage.replace(/_/g, " ")} />
        <Row label="Contact" value={entry.contactName ?? "—"} />
        <Row label="Contact email" value={entry.contactEmail ?? "—"} />
        <Row label={t("pipeline.owner")} value={entry.owner ?? "—"} />
        <Row label={t("pipeline.nextAction")} value={entry.nextAction ?? "—"} />
        <Row label="Next action date" value={entry.nextActionDate ?? "—"} />
        <Row label={t("pipeline.lastActivity")} value={entry.lastContactDate ?? "—"} />
        <Row label={t("pipeline.priority")} value={entry.probability != null ? `${entry.probability}%` : "—"} />
        <Row label="Geography" value={entry.geography ?? "—"} />
        <Row label="Estimated grant size" value={entry.estimatedGrantSize ?? "—"} />
      </dl>
      <div className="mt-4">
        <div className="flex items-center justify-between">
          <span className="text-base font-semibold text-foreground">{t("drawer.copyNotes")}</span>
          <button
            type="button"
            onClick={copyNotes}
            disabled={!entry.notes}
            className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label={t("drawer.copyNotes")}
          >
            {t("common:copy", { ns: "common" })}
          </button>
        </div>
        <div className="mt-2 rounded-md border border-border bg-background p-3 text-sm text-muted-foreground">
          {entry.notes || "—"}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-36 shrink-0 font-medium text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}
