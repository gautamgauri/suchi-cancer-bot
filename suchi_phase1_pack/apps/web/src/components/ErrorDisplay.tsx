import React from "react";

interface ErrorDisplayProps {
  message?: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}

export const ErrorDisplay: React.FC<ErrorDisplayProps> = ({
  message = "Something went wrong. Please try again.",
  onRetry,
  onDismiss
}) => {
  return (
    <div style={styles.container} role="alert" aria-live="assertive">
      <div style={styles.content}>
        <div style={styles.icon} aria-hidden="true">⚠️</div>
        <div style={styles.textContainer}>
          <p style={styles.message}>{message}</p>
          <p style={styles.helpText}>
            If this problem persists, please try refreshing the page or contact support.
          </p>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            style={styles.dismissButton}
            aria-label="Dismiss error"
          >
            ×
          </button>
        )}
      </div>
      {onRetry && (
        <button onClick={onRetry} style={styles.retryButton}>
          Try Again
        </button>
      )}
    </div>
  );
};

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    padding: "16px 20px",
    backgroundColor: "#FEE2E2",
    border: "1px solid var(--color-error)",
    borderRadius: "var(--radius-md)",
    margin: "16px 20px"
  },
  content: {
    display: "flex",
    gap: "12px",
    alignItems: "flex-start"
  },
  icon: {
    fontSize: "24px",
    flexShrink: 0
  },
  textContainer: {
    flex: 1
  },
  message: {
    margin: 0,
    fontSize: "var(--font-size-base)",
    fontWeight: "600",
    color: "#991B1B",
    marginBottom: "4px"
  },
  helpText: {
    margin: 0,
    fontSize: "var(--font-size-sm)",
    color: "#991B1B",
    opacity: 0.8
  },
  dismissButton: {
    background: "none",
    border: "none",
    fontSize: "24px",
    color: "#991B1B",
    cursor: "pointer",
    padding: "0",
    width: "24px",
    height: "24px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0
  },
  retryButton: {
    marginTop: "12px",
    padding: "8px 16px",
    fontSize: "var(--font-size-sm)",
    fontWeight: "600",
    color: "var(--color-text-on-primary)",
    backgroundColor: "var(--color-error)",
    border: "none",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
    transition: "var(--transition-base)"
  }
};









