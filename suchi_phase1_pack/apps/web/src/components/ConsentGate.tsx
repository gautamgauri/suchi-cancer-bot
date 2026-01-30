import React, { useState } from "react";

interface ConsentGateProps {
  onAccept: () => void;
  error?: string | null;
}

export const ConsentGate: React.FC<ConsentGateProps> = ({ onAccept, error }) => {
  const [accepted, setAccepted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (accepted) {
      onAccept();
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        <h1 style={styles.title}>Welcome to Suchi</h1>
        <p style={styles.subtitle}>Suchitra Cancer Care Foundation - Information Assistant</p>

        <div style={styles.warningBox}>
          <h2 style={styles.warningTitle}>⚠️ Emergency Warning</h2>
          <p style={styles.warningText}>
            If you are experiencing a medical emergency, please contact local emergency services immediately.
            Do not rely on this chat for urgent medical decisions.
          </p>
        </div>

        <div style={styles.disclaimerBox}>
          <h2 style={styles.disclaimerTitle}>Important Disclaimer</h2>
          <ul style={styles.disclaimerList}>
            <li>This chatbot provides general information and cannot diagnose cancer or any medical condition.</li>
            <li>It cannot prescribe medications, recommend dosages, or interpret test results.</li>
            <li>Always consult with qualified healthcare professionals for medical advice.</li>
            <li>Your conversations are anonymous by default. <span style={styles.privacyNote}>(We don't ask your name or contact info. Anonymized data may be used to improve the service.)</span></li>
          </ul>
        </div>

        {error && (
          <div style={styles.errorBox}>
            <strong>⚠️ Connection Error:</strong> {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={styles.form}>
          <label style={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              style={styles.checkbox}
            />
            <span>I understand and accept the terms above</span>
          </label>

          <button
            type="submit"
            disabled={!accepted}
            style={{
              ...styles.button,
              ...(!accepted ? styles.buttonDisabled : {})
            }}
          >
            Continue to Chat
          </button>
        </form>
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
    backgroundColor: "var(--color-background)"
  },
  content: {
    maxWidth: "600px",
    width: "100%",
    backgroundColor: "var(--color-surface)",
    borderRadius: "var(--radius-lg)",
    padding: "40px",
    boxShadow: "var(--shadow-lg)"
  },
  title: {
    fontSize: "var(--font-size-3xl)",
    fontWeight: "bold",
    marginBottom: "8px",
    color: "var(--color-primary)"
  },
  subtitle: {
    fontSize: "var(--font-size-base)",
    color: "var(--color-text-secondary)",
    marginBottom: "32px"
  },
  warningBox: {
    backgroundColor: "var(--color-warning-bg)",
    border: "1px solid var(--color-warning)",
    borderRadius: "var(--radius-md)",
    padding: "20px",
    marginBottom: "24px"
  },
  warningTitle: {
    fontSize: "var(--font-size-lg)",
    fontWeight: "bold",
    marginBottom: "12px",
    color: "var(--color-warning-text)"
  },
  warningText: {
    fontSize: "var(--font-size-sm)",
    color: "var(--color-warning-text)",
    lineHeight: "1.6"
  },
  disclaimerBox: {
    backgroundColor: "var(--color-surface-alt)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-md)",
    padding: "20px",
    marginBottom: "32px"
  },
  disclaimerTitle: {
    fontSize: "var(--font-size-lg)",
    fontWeight: "bold",
    marginBottom: "12px",
    color: "var(--color-text)"
  },
  disclaimerList: {
    fontSize: "var(--font-size-sm)",
    color: "var(--color-text)",
    lineHeight: "1.8",
    paddingLeft: "20px"
  },
  privacyNote: {
    fontSize: "var(--font-size-xs)",
    color: "var(--color-text-secondary)",
    fontStyle: "italic"
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "20px"
  },
  checkboxLabel: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    fontSize: "14px",
    cursor: "pointer",
    userSelect: "none"
  },
  checkbox: {
    width: "20px",
    height: "20px",
    cursor: "pointer"
  },
  button: {
    padding: "14px 28px",
    fontSize: "var(--font-size-base)",
    fontWeight: "600",
    color: "var(--color-action-text)",
    backgroundColor: "var(--color-action)",
    border: "none",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
    transition: "var(--transition-base)"
  },
  buttonDisabled: {
    backgroundColor: "var(--color-text-muted)",
    cursor: "not-allowed",
    opacity: 0.5
  },
  errorBox: {
    backgroundColor: "var(--color-error-bg)",
    border: "2px solid var(--color-error)",
    borderRadius: "var(--radius-md)",
    padding: "16px",
    marginBottom: "20px",
    color: "var(--color-error-text)",
    fontSize: "var(--font-size-sm)",
    lineHeight: "1.6"
  }
};









