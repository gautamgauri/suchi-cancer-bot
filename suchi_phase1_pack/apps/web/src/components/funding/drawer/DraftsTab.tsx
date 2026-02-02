import { useTranslation } from "react-i18next";
import { EmptyState } from "../EmptyState";

interface DraftsTabProps {
  entryId: string;
  compact?: boolean;
}

export function DraftsTab({ entryId: _entryId, compact = false }: DraftsTabProps) {
  const { t } = useTranslation("funding");
  const p = compact ? "p-2" : "p-4";

  // TODO: Implement drafts list with API integration using _entryId
  // For now, show empty state
  return (
    <div className={p}>
      <h3 className="text-base font-semibold text-foreground">{t("drawer.drafts")}</h3>
      <EmptyState
        message={t("drafts.noDrafts", "No drafts yet")}
        className="mt-4"
      />
    </div>
  );
}
