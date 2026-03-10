import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { fundingApiService } from "../services/fundingApi";
import type { PipelineStage } from "../services/fundingApi";
import { useFundingUi } from "../context/FundingUiContext";
import { AppShell } from "../components/funding/AppShell";
import { EmptyState } from "../components/funding/EmptyState";
import { ErrorState } from "../components/funding/ErrorState";
import { PipelineTableSkeleton } from "../components/funding/Skeletons";
import { TopBanner } from "../components/funding/TopBanner";
import { EntryDrawer } from "../components/funding/EntryDrawer";
import { formatDateShort, formatDate } from "../utils/format";

const STAGE_OPTIONS: PipelineStage[] = [
  "RFP_received",
  "lead",
  "qualified",
  "proposal_sent",
  "won",
  "lost",
];

export function PipelinePage() {
  const { t } = useTranslation("funding");
  const { compact } = useFundingUi();
  const [search, setSearch] = useState("");
  const [filterStage, setFilterStage] = useState<string>("");
  const [filterOwner, setFilterOwner] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const { data, isLoading, error, refetch, isError } = useQuery({
    queryKey: ["pipeline"],
    queryFn: () => fundingApiService.getPipeline(),
    staleTime: 30_000,
  });

  const entries = data?.entries ?? [];
  const filtered = useMemo(() => {
    let list = entries;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (e) =>
          e.orgName?.toLowerCase().includes(q) ||
          e.contactName?.toLowerCase().includes(q) ||
          e.notes?.toLowerCase().includes(q)
      );
    }
    if (filterStage) list = list.filter((e) => e.stage === filterStage);
    if (filterOwner.trim())
      list = list.filter((e) =>
        e.owner?.toLowerCase().includes(filterOwner.trim().toLowerCase())
      );
    if (filterPriority.trim()) {
      const p = filterPriority.trim();
      list = list.filter((e) => {
        const prob = e.probability;
        if (prob == null) return p === "—" || p === "";
        if (p === "high") return prob >= 70;
        if (p === "medium") return prob >= 30 && prob < 70;
        if (p === "low") return prob < 30;
        return String(prob).includes(p);
      });
    }
    return list;
  }, [entries, search, filterStage, filterOwner, filterPriority]);

  const handlePrint = () => {
    window.print();
  };

  const showBanner =
    isError &&
    !bannerDismissed &&
    (localStorage.getItem("funding_banner_api") !== "dismissed" || true);

  return (
    <AppShell apiConfigured={!isError}>
      {showBanner && (
        <TopBanner
          message={t("banner.apiNotConfigured")}
          dismissible
          storageKey="funding_banner_api"
          onDismiss={() => setBannerDismissed(true)}
          className="mb-4"
        />
      )}

      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-foreground md:text-2xl">
          {t("pipeline.title")}
        </h1>

        {/* Top bar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border pb-4 print:hidden">
          <input
            type="search"
            placeholder={t("pipeline.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            aria-label={t("pipeline.searchPlaceholder")}
          />
          <select
            value={filterStage}
            onChange={(e) => setFilterStage(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            aria-label={t("pipeline.filterStage")}
          >
            <option value="">{t("pipeline.filterStage")}</option>
            {STAGE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder={t("pipeline.filterOwner")}
            value={filterOwner}
            onChange={(e) => setFilterOwner(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            aria-label={t("pipeline.filterOwner")}
          />
          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            aria-label={t("pipeline.filterPriority")}
          >
            <option value="">{t("pipeline.filterPriority")}</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <button
            type="button"
            onClick={handlePrint}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            aria-label={t("pipeline.title")}
          >
            {t("common:printPipeline")}
          </button>
        </div>

        {/* Content */}
        {isLoading && <PipelineTableSkeleton compact={compact} />}
        {!isLoading && isError && (
          <ErrorState
            message={error instanceof Error ? error.message : "Failed to load pipeline"}
            onRetry={() => refetch()}
            showApiHint
          />
        )}
        {!isLoading && !isError && filtered.length === 0 && (
          <EmptyState
            message={entries.length === 0 ? t("pipeline.noEntries") : "No matches"}
          />
        )}
        {!isLoading && !isError && filtered.length > 0 && (
          <div className="overflow-auto rounded-lg border border-border bg-card">
            <div className="hidden print:block mb-4" aria-hidden="true">
              <h1 className="text-lg font-semibold text-foreground">{t("print.title")}</h1>
              <p className="text-sm text-muted-foreground">
                {t("print.printedAt")} {formatDate(new Date())}
              </p>
            </div>
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 z-10 border-b border-border bg-muted/80">
                <tr>
                  <th className="p-2 text-sm font-semibold text-foreground">
                    {t("pipeline.orgName")}
                  </th>
                  <th className="p-2 text-sm font-semibold text-foreground">
                    {t("pipeline.stage")}
                  </th>
                  <th className="p-2 text-sm font-semibold text-foreground">
                    {t("pipeline.nextAction")}
                  </th>
                  <th className="p-2 text-sm font-semibold text-foreground">
                    {t("pipeline.owner")}
                  </th>
                  <th className="p-2 text-sm font-semibold text-foreground">
                    {t("pipeline.deadline")}
                  </th>
                  <th className="p-2 text-sm font-semibold text-foreground">
                    {t("pipeline.priority")}
                  </th>
                  <th className="p-2 text-sm font-semibold text-foreground">
                    {t("pipeline.lastActivity")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => (
                  <tr
                    key={entry.id}
                    onClick={() => setSelectedId(entry.id)}
                    className={`cursor-pointer border-b border-border hover:bg-muted/50 ${
                      selectedId === entry.id ? "bg-accent/20" : ""
                    }`}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedId(entry.id);
                      }
                    }}
                  >
                    <TableCell compact={compact} value={entry.orgName} />
                    <TableCell compact={compact}>
                      <span className="inline-flex rounded-full bg-accent/30 px-2 py-0.5 text-xs font-medium text-accent-foreground">
                        {entry.stage.replace(/_/g, " ")}
                      </span>
                    </TableCell>
                    <TableCell compact={compact} value={entry.nextAction ?? "—"} />
                    <TableCell compact={compact} value={entry.owner ?? entry.assignedTo ?? "—"} />
                    <TableCell compact={compact}>
                      {entry.deadline ? formatDateShort(entry.deadline) : "—"}
                    </TableCell>
                    <TableCell compact={compact}>
                      <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {entry.probability != null ? `${entry.probability}%` : "—"}
                      </span>
                    </TableCell>
                    <TableCell compact={compact}>
                      {entry.lastContactDate
                        ? formatDateShort(entry.lastContactDate)
                        : "—"}
                    </TableCell>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedId && (
        <EntryDrawer
          entryId={selectedId}
          onClose={() => setSelectedId(null)}
          compact={compact}
        />
      )}
    </AppShell>
  );
}

function TableCell({
  compact,
  children,
  value,
}: {
  compact: boolean;
  children?: React.ReactNode;
  value?: string;
}) {
  const cls = compact ? "p-2 text-sm" : "p-3 text-sm";
  return (
    <td className={cls}>
      {children ?? (value ?? "—")}
    </td>
  );
}
