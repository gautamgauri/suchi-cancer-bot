import React, { useState, useEffect } from "react";
import { SuchiAvatar } from "./SuchiAvatar";

interface WelcomeMessageProps {
  onDismiss?: () => void;
  onGetStarted?: () => void;
}

export const WelcomeMessage: React.FC<WelcomeMessageProps> = ({
  onDismiss,
  onGetStarted
}) => {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    // Check if user has seen welcome message before
    const hasSeenWelcome = localStorage.getItem("suchi_welcome_seen");
    if (hasSeenWelcome) {
      setIsVisible(false);
    }
  }, []);

  const handleDismiss = () => {
    localStorage.setItem("suchi_welcome_seen", "true");
    setIsVisible(false);
    onDismiss?.();
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div style={styles.container} role="dialog" aria-labelledby="welcome-title">
      <div style={styles.content}>
        <div style={styles.header}>
          <SuchiAvatar size="large" animated={true} />
          <button
            onClick={handleDismiss}
            style={styles.closeButton}
            aria-label="Close welcome message"
          >
            ×
          </button>
        </div>
        <h2 id="welcome-title" style={styles.title}>
          Welcome to Suchi
        </h2>
        <p style={styles.description}>
          I'm your trusted cancer information assistant. I'm here to help you:
        </p>
        <ul style={styles.featuresList}>
          <li style={styles.listItem}>Understand cancer-related information</li>
          <li style={styles.listItem}>Navigate your questions with evidence-based answers</li>
          <li style={styles.listItem}>Find trusted sources and resources</li>
          <li style={styles.listItem}>Get support in a safe, supportive environment</li>
        </ul>
        <div style={styles.actions}>
          {onGetStarted && (
            <button
              onClick={() => {
                handleDismiss();
                onGetStarted();
              }}
              style={styles.primaryButton}
            >
              Get Started
            </button>
          )}
          <button onClick={handleDismiss} style={styles.secondaryButton}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
};

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    padding: "20px"
  },
  content: {
    backgroundColor: "var(--color-surface)",
    borderRadius: "var(--radius-lg)",
    padding: "32px",
    maxWidth: "500px",
    width: "100%",
    boxShadow: "var(--shadow-lg)",
    position: "relative"
  },
  header: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: "24px",
    position: "relative"
  },
  closeButton: {
    position: "absolute",
    top: "-8px",
    right: "-8px",
    background: "none",
    border: "none",
    fontSize: "32px",
    color: "var(--color-text-secondary)",
    cursor: "pointer",
    width: "32px",
    height: "32px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "50%",
    transition: "var(--transition-base)"
  },
  title: {
    fontSize: "var(--font-size-2xl)",
    fontWeight: "bold",
    color: "var(--color-primary)",
    margin: "0 0 16px 0",
    textAlign: "center"
  },
  description: {
    fontSize: "var(--font-size-base)",
    color: "var(--color-text)",
    margin: "0 0 20px 0",
    lineHeight: "1.6"
  },
  featuresList: {
    listStyle: "none",
    padding: 0,
    margin: "0 0 24px 0"
  },
  featuresListLi: {
    padding: "8px 0",
    paddingLeft: "24px",
    position: "relative",
    fontSize: "var(--font-size-base)",
    color: "var(--color-text)",
    lineHeight: "1.6"
  },
  actions: {
    display: "flex",
    gap: "12px",
    justifyContent: "center"
  },
  primaryButton: {
    padding: "12px 24px",
    fontSize: "var(--font-size-base)",
    fontWeight: "600",
    color: "var(--color-text-on-primary)",
    backgroundColor: "var(--color-primary)",
    border: "none",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
    transition: "var(--transition-base)"
  },
  secondaryButton: {
    padding: "12px 24px",
    fontSize: "var(--font-size-base)",
    fontWeight: "500",
    color: "var(--color-text)",
    backgroundColor: "transparent",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
    transition: "var(--transition-base)"
  },
  listItem: {
    padding: "8px 0",
    paddingLeft: "24px",
    position: "relative",
    fontSize: "var(--font-size-base)",
    color: "var(--color-text)",
    lineHeight: "1.6"
  }
};


