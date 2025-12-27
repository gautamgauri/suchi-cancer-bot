import React, { useState } from "react";

interface ConsentGateProps {
  onAccept: () => void;
}

export const ConsentGate: React.FC<ConsentGateProps> = ({ onAccept }) => {
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
            <li>Your conversations are anonymous by default.</li>
          </ul>
        </div>

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
    backgroundColor: "#f5f5f5"
  },
  content: {
    maxWidth: "600px",
    width: "100%",
    backgroundColor: "white",
    borderRadius: "12px",
    padding: "40px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.1)"
  },
  title: {
    fontSize: "32px",
    fontWeight: "bold",
    marginBottom: "8px",
    color: "#1a1a1a"
  },
  subtitle: {
    fontSize: "16px",
    color: "#666",
    marginBottom: "32px"
  },
  warningBox: {
    backgroundColor: "#fff3cd",
    border: "1px solid #ffc107",
    borderRadius: "8px",
    padding: "20px",
    marginBottom: "24px"
  },
  warningTitle: {
    fontSize: "18px",
    fontWeight: "bold",
    marginBottom: "12px",
    color: "#856404"
  },
  warningText: {
    fontSize: "14px",
    color: "#856404",
    lineHeight: "1.6"
  },
  disclaimerBox: {
    backgroundColor: "#f8f9fa",
    border: "1px solid #dee2e6",
    borderRadius: "8px",
    padding: "20px",
    marginBottom: "32px"
  },
  disclaimerTitle: {
    fontSize: "18px",
    fontWeight: "bold",
    marginBottom: "12px",
    color: "#1a1a1a"
  },
  disclaimerList: {
    fontSize: "14px",
    color: "#495057",
    lineHeight: "1.8",
    paddingLeft: "20px"
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
    fontSize: "16px",
    fontWeight: "600",
    color: "white",
    backgroundColor: "#007bff",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    transition: "background-color 0.2s"
  },
  buttonDisabled: {
    backgroundColor: "#ccc",
    cursor: "not-allowed"
  }
};

