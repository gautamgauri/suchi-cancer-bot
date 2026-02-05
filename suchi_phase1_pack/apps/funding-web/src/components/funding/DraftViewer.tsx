import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { fundingApiService, type SourceDocumentRecord } from "../../services/fundingApi";
import { extractCitationDocIds } from "../../utils/citations";

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
  const [sources, setSources] = useState<SourceDocumentRecord[]>([]);
  const [missingDocIds, setMissingDocIds] = useState<string[]>([]);

  useEffect(() => {
    const docIds = extractCitationDocIds(text);
    if (docIds.length === 0) {
      setSources([]);
      setMissingDocIds([]);
      return;
    }
    fundingApiService
      .getSourcesBatch(docIds)
      .then(({ sources: list }) => {
        const found = new Set(list.map((s) => s.docId));
        setSources(list);
        setMissingDocIds(docIds.filter((id) => !found.has(id)));
      })
      .catch(() => {
        setSources([]);
        setMissingDocIds(docIds);
      });
  }, [text]);

  const hasSources = sources.length > 0 || missingDocIds.length > 0;

  return (
    <div className={`rounded-lg border border-border bg-card ${className}`}>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words p-3 text-sm text-foreground">
        {text}
      </pre>
      {hasSources && (
        <div className="border-t border-border p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("drafts.sources")}
          </p>
          <ul className="mt-2 list-none space-y-1 text-sm text-foreground" aria-label={t("drafts.sources")}>
            {sources.map((s) => (
              <li key={s.docId}>
                {s.url ? (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline hover:no-underline"
                  >
                    {s.title || s.docId}
                  </a>
                ) : (
                  <span>{s.title || s.docId}</span>
                )}
                {s.retrievedAt && (
                  <span className="ml-1 text-muted-foreground">
                    ({new Date(s.retrievedAt).toLocaleDateString()})
                  </span>
                )}
                {s.snapshotUrl && (
                  <a
                    href={s.snapshotUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 text-xs text-muted-foreground underline hover:no-underline"
                  >
                    Snapshot
                  </a>
                )}
              </li>
            ))}
            {missingDocIds.map((docId) => (
              <li key={docId} className="text-muted-foreground">
                {docId}
              </li>
            ))}
          </ul>
        </div>
      )}
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
