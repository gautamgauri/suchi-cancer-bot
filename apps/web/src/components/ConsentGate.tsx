import React from "react";

interface ConsentGateProps {
  onAccept: () => void;
  error?: string | null;
}

export const ConsentGate: React.FC<ConsentGateProps> = ({ onAccept, error }) => {
  return (
    <div style={styles.container}>
      <div style={styles.content}>
        <div style={styles.greeting}>
          <span style={styles.emoji} role="img" aria-label="namaste">🙏</span>
          <h1 style={styles.title}>Namaste! I'm Suchi</h1>
          <p style={styles.subtitle}>Your cancer information companion</p>
        </div>

        <div style={styles.helpSection}>
          <p style={styles.helpIntro}>I can help you:</p>
          <ul style={styles.helpList}>
            <li style={styles.helpItem}>
              <span style={styles.bullet}>•</span>
              Understand cancer symptoms and screening
            </li>
            <li style={styles.helpItem}>
              <span style={styles.bullet}>•</span>
              Prepare questions for your doctor
            </li>
            <li style={styles.helpItem}>
              <span style={styles.bullet}>•</span>
              Navigate treatment options and costs
            </li>
            <li style={styles.helpItem}>
              <span style={styles.bullet}>•</span>
              Find support and financial assistance
            </li>
          </ul>
        </div>

        {error && (
          <div style={styles.errorBox}>
            <strong>Connection issue:</strong> {error}
          </div>
        )}

        <button
          onClick={onAccept}
          style={styles.button}
        >
          Start chatting →
        </button>

        <p style={styles.disclaimer}>
          Suchi provides general health information, not medical diagnosis.
          Always consult your doctor for personal medical advice.
          Your conversations are anonymous.
        </p>
      </div>
    </div>
  );
};

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    minHeight: "100vh",
    padding: "20px",
    backgroundColor: "var(--color-background)",
  },
  content: {
    maxWidth: "480px",
    width: "100%",
    backgroundColor: "var(--color-surface)",
    borderRadius: "var(--radius-lg)",
    padding: "36px 32px",
    boxShadow: "var(--shadow-lg)",
    textAlign: "center",
  },
  greeting: {
    marginBottom: "28px",
  },
  emoji: {
    fontSize: "48px",
    display: "block",
    marginBottom: "12px",
  },
  title: {
    fontSize: "var(--font-size-2xl)",
    fontWeight: "bold",
    marginBottom: "6px",
    color: "var(--color-primary)",
    margin: "0 0 6px 0",
  },
  subtitle: {
    fontSize: "var(--font-size-base)",
    color: "var(--color-text-secondary)",
    margin: 0,
  },
  helpSection: {
    textAlign: "left",
    marginBottom: "28px",
  },
  helpIntro: {
    fontSize: "var(--font-size-base)",
    color: "var(--color-text)",
    marginBottom: "12px",
    fontWeight: "500",
  },
  helpList: {
    listStyle: "none",
    padding: 0,
    margin: 0,
  },
  helpItem: {
    fontSize: "var(--font-size-base)",
    color: "var(--color-text)",
    lineHeight: "1.8",
    display: "flex",
    alignItems: "baseline",
    gap: "10px",
  },
  bullet: {
    color: "var(--color-primary)",
    fontWeight: "bold",
    flexShrink: 0,
  },
  button: {
    width: "100%",
    padding: "14px 28px",
    fontSize: "var(--font-size-lg)",
    fontWeight: "600",
    color: "var(--color-action-text)",
    backgroundColor: "var(--color-action)",
    border: "none",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
    transition: "var(--transition-base)",
    marginBottom: "20px",
  },
  disclaimer: {
    fontSize: "var(--font-size-xs)",
    color: "var(--color-text-muted)",
    lineHeight: "1.6",
    margin: 0,
  },
  errorBox: {
    backgroundColor: "var(--color-error-bg)",
    border: "1px solid var(--color-error)",
    borderRadius: "var(--radius-md)",
    padding: "12px",
    marginBottom: "20px",
    color: "var(--color-error-text)",
    fontSize: "var(--font-size-sm)",
    lineHeight: "1.6",
    textAlign: "left",
  },
};
