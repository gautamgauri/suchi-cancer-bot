import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { fundingApiService } from "../../services/fundingApi";
import { DrawerSkeleton } from "./Skeletons";
import { OverviewTab } from "./drawer/OverviewTab";
import { ActivityTab } from "./drawer/ActivityTab";
import { DraftsTab } from "./drawer/DraftsTab";

type DrawerTabId = "overview" | "activity" | "drafts";

interface EntryDrawerProps {
  entryId: string;
  onClose: () => void;
  compact?: boolean;
}

export function EntryDrawer({ entryId, onClose, compact = false }: EntryDrawerProps) {
  const { t } = useTranslation("funding");
  const [activeTab, setActiveTab] = useState<DrawerTabId>("overview");
  const drawerRef = useRef<HTMLDivElement>(null);
  const previousActiveRef = useRef<HTMLElement | null>(null);

  const { data: entry, isLoading, error } = useQuery({
    queryKey: ["pipeline-entry", entryId],
    queryFn: () => fundingApiService.getEntry(entryId),
    enabled: !!entryId,
  });

  // Focus trap
  useEffect(() => {
    previousActiveRef.current = document.activeElement as HTMLElement | null;
    drawerRef.current?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !drawerRef.current) return;
      const focusable = drawerRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first && last) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last && first) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousActiveRef.current?.focus?.();
    };
  }, [entryId, onClose]);

  const tabs: { id: DrawerTabId; labelKey: string }[] = [
    { id: "overview", labelKey: "drawer.overview" },
    { id: "activity", labelKey: "drawer.activity" },
    { id: "drafts", labelKey: "drawer.drafts" },
  ];

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-foreground/20 print:hidden"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={entry ? `${entry.orgName} – details` : "Entry details"}
        tabIndex={-1}
        className="fixed right-0 top-0 z-50 flex h-full w-full flex-col border-l border-border bg-card shadow-lg focus:outline-none md:w-[420px] lg:w-[480px]"
      >
        {isLoading && <DrawerSkeleton />}
        {error && (
          <div className="p-4 text-sm text-destructive">
            Failed to load entry. <button type="button" onClick={onClose}>Close</button>
          </div>
        )}
        {entry && (
          <>
            {/* Drawer header */}
            <div className="flex shrink-0 items-center justify-between border-b border-border p-4">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-semibold text-foreground">
                  {entry.orgName}
                </h2>
                <div className="mt-1 flex gap-2">
                  <span className="inline-flex rounded-full bg-accent/30 px-2 py-0.5 text-xs font-medium text-accent-foreground">
                    {entry.stage.replace(/_/g, " ")}
                  </span>
                  {entry.probability != null && (
                    <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {entry.probability}%
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(entry.orgName);
                  }}
                  className="rounded p-2 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
                  aria-label={t("drawer.copyOrgName")}
                >
                  📋
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded p-2 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
                  aria-label={t("common:close", { ns: "common" })}
                >
                  ×
                </button>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex shrink-0 border-b border-border px-4">
              {tabs.map(({ id, labelKey }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={`border-b-2 px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${
                    activeTab === id
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                  aria-selected={activeTab === id}
                  aria-controls={`panel-${id}`}
                  id={`tab-${id}`}
                >
                  {t(labelKey)}
                </button>
              ))}
            </div>

            {/* Tab panels */}
            <div className="flex-1 overflow-auto">
              {activeTab === "overview" && (
                <div id="panel-overview" role="tabpanel" aria-labelledby="tab-overview">
                  <OverviewTab entry={entry} compact={compact} />
                </div>
              )}
              {activeTab === "activity" && (
                <div id="panel-activity" role="tabpanel" aria-labelledby="tab-activity">
                  <ActivityTab entryId={entry.id} compact={compact} />
                </div>
              )}
              {activeTab === "drafts" && (
                <div id="panel-drafts" role="tabpanel" aria-labelledby="tab-drafts">
                  <DraftsTab entryId={entry.id} compact={compact} />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
