import React, { useState } from "react";

export interface CitationData {
  docId: string;
  chunkId: string;
  title?: string;
  url?: string;
  sourceType?: string | null;
  source?: string | null;
  isTrusted?: boolean;
}

interface CitationProps {
  citation: CitationData;
  index: number;
}

export const Citation: React.FC<CitationProps> = ({ citation, index }) => {
  const [showTooltip, setShowTooltip] = useState(false);

  const citationNumber = index + 1;
  const displayTitle = citation.title || "Source";
  const isTrusted = citation.isTrusted || citation.sourceType === "NCI" || citation.source?.includes("National Cancer Institute");

  return (
    <span
      style={styles.citation}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      role="button"
      tabIndex={0}
      aria-label={`Citation ${citationNumber}: ${displayTitle}`}
    >
      [{citationNumber}]
      {showTooltip && (
        <div style={styles.tooltip} role="tooltip">
          <div style={styles.tooltipHeader}>
            <span style={styles.tooltipTitle}>{displayTitle}</span>
            {isTrusted && (
              <span style={styles.trustedBadge} aria-label="Trusted source">
                ✓ Trusted
              </span>
            )}
          </div>
          {citation.source && (
            <div style={styles.tooltipSource}>{citation.source}</div>
          )}
          {citation.url && (
            <a
              href={citation.url}
              target="_blank"
              rel="noopener noreferrer"
              style={styles.tooltipLink}
              onClick={(e) => e.stopPropagation()}
            >
              View source →
            </a>
          )}
        </div>
      )}
    </span>
  );
};

const styles: { [key: string]: React.CSSProperties } = {
  citation: {
    position: "relative",
    display: "inline-block",
    color: "var(--color-primary)",
    fontWeight: "600",
    cursor: "pointer",
    textDecoration: "underline",
    textDecorationStyle: "dotted",
    marginLeft: "2px",
    marginRight: "2px"
  },
  tooltip: {
    position: "absolute",
    bottom: "100%",
    left: "50%",
    transform: "translateX(-50%)",
    marginBottom: "8px",
    backgroundColor: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-md)",
    padding: "12px",
    minWidth: "250px",
    maxWidth: "350px",
    boxShadow: "var(--shadow-lg)",
    zIndex: 1000,
    fontSize: "var(--font-size-sm)",
    lineHeight: "1.5"
  },
  tooltipHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: "8px",
    gap: "8px"
  },
  tooltipTitle: {
    fontWeight: "600",
    color: "var(--color-text)",
    flex: 1
  },
  trustedBadge: {
    backgroundColor: "var(--color-success)",
    color: "var(--color-text-on-primary)",
    padding: "2px 8px",
    borderRadius: "var(--radius-sm)",
    fontSize: "11px",
    fontWeight: "600",
    whiteSpace: "nowrap"
  },
  tooltipSource: {
    color: "var(--color-text-secondary)",
    fontSize: "12px",
    marginBottom: "8px"
  },
  tooltipLink: {
    color: "var(--color-primary)",
    textDecoration: "none",
    fontSize: "12px",
    fontWeight: "500"
  }
};





