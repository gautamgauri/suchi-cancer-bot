import { useTranslation } from "react-i18next";

interface DraftViewerProps {
  text: string;
  onCopy: () => void;
  onDownloadTxt?: () => void;
  onLogAsActivity?: () => void;
  className?: string;
}

export function DraftViewer({
  text,
  onCopy,
  onDownloadTxt,
  onLogAsActivity,
  className = "",
}: DraftViewerProps) {
  const { t } = useTranslation("funding");

  return (
    <div className={`rounded-lg border border-border bg-card ${className}`}>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words p-3 text-sm text-foreground">
        {text}
      </pre>
      <div className="flex flex-wrap gap-2 border-t border-border p-2">
        <button
          type="button"
          onClick={onCopy}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label={t("common:copy", { ns: "common" })}
        >
          {t("common:copy", { ns: "common" })}
        </button>
        {onDownloadTxt && (
          <button
            type="button"
            onClick={onDownloadTxt}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label={t("drafts.downloadTxt")}
          >
            {t("drafts.downloadTxt")}
          </button>
        )}
        {onLogAsActivity && (
          <button
            type="button"
            onClick={onLogAsActivity}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label={t("drafts.logAsActivity")}
          >
            {t("drafts.logAsActivity")}
          </button>
        )}
      </div>
    </div>
  );
}
