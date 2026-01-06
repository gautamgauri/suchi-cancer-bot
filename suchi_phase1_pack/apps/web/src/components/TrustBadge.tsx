import React from "react";

interface TrustBadgeProps {
  sourceType?: string | null;
  source?: string | null;
  compact?: boolean;
}

export const TrustBadge: React.FC<TrustBadgeProps> = ({ 
  sourceType, 
  source,
  compact = false 
}) => {
  const isTrusted = 
    sourceType === "NCI" || 
    source?.includes("National Cancer Institute") ||
    source?.includes("NCI") ||
    sourceType === "trusted";

  if (!isTrusted) {
    return null;
  }

  return (
    <div
      style={compact ? styles.compact : styles.badge}
      aria-label="Trusted source"
      role="status"
    >
      <span style={styles.icon} aria-hidden="true">✓</span>
      <span style={styles.text}>
        {compact ? "Trusted" : "Trusted Source"}
      </span>
    </div>
  );
};

const styles: { [key: string]: React.CSSProperties } = {
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    backgroundColor: "var(--color-success)",
    color: "var(--color-text-on-primary)",
    padding: "4px 10px",
    borderRadius: "var(--radius-full)",
    fontSize: "var(--font-size-xs)",
    fontWeight: "600",
    marginLeft: "8px"
  },
  compact: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    backgroundColor: "var(--color-success)",
    color: "var(--color-text-on-primary)",
    padding: "2px 6px",
    borderRadius: "var(--radius-sm)",
    fontSize: "10px",
    fontWeight: "600"
  },
  icon: {
    fontSize: "12px"
  },
  text: {
    fontSize: "inherit"
  }
};





