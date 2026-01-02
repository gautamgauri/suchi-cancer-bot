import React from "react";
import { SuchiAvatar } from "./SuchiAvatar";

interface LoadingIndicatorProps {
  message?: string;
}

export const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({
  message = "Suchi is thinking..."
}) => {
  return (
    <div style={styles.container} role="status" aria-live="polite" aria-label="Loading">
      <div style={styles.content}>
        <SuchiAvatar size="small" animated={true} />
        <div style={styles.textContainer}>
          <p style={styles.message}>{message}</p>
          <div style={styles.dots}>
            <span style={{ ...styles.dot, animationDelay: "0s" }}>.</span>
            <span style={{ ...styles.dot, animationDelay: "0.2s" }}>.</span>
            <span style={{ ...styles.dot, animationDelay: "0.4s" }}>.</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    padding: "20px",
    display: "flex",
    justifyContent: "flex-start"
  },
  content: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    backgroundColor: "var(--color-surface-alt)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-lg)",
    padding: "12px 16px"
  },
  textContainer: {
    display: "flex",
    alignItems: "center",
    gap: "4px"
  },
  message: {
    margin: 0,
    fontSize: "var(--font-size-sm)",
    color: "var(--color-text-secondary)",
    fontStyle: "italic"
  },
  dots: {
    display: "inline-flex",
    gap: "2px"
  },
  dot: {
    fontSize: "20px",
    lineHeight: "1",
    animation: "pulse 1.4s ease-in-out infinite"
  }
};


