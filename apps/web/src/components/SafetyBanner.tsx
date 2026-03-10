import React from "react";

interface SafetyBannerProps {
  classification: "red_flag" | "self_harm";
  message: string;
}

export const SafetyBanner: React.FC<SafetyBannerProps> = ({ classification, message }) => {
  const isEmergency = classification === "red_flag";

  return (
    <div
      style={{
        ...styles.banner,
        backgroundColor: isEmergency ? "#FEE2E2" : "#FEF3C7",
        borderColor: isEmergency ? "#FCA5A5" : "#FCD34D"
      }}
    >
      <div style={styles.icon}>{isEmergency ? "🚨" : "⚠️"}</div>
      <div style={styles.content}>
        <div style={styles.title}>
          {isEmergency ? "Seek Emergency Medical Care" : "Important Notice"}
        </div>
        <div style={styles.message}>{message}</div>
      </div>
    </div>
  );
};

const styles: { [key: string]: React.CSSProperties } = {
  banner: {
    display: "flex",
    gap: "16px",
    padding: "20px",
    marginBottom: "20px",
    borderRadius: "8px",
    border: "2px solid",
    alignItems: "flex-start"
  },
  icon: {
    fontSize: "32px",
    flexShrink: 0
  },
  content: {
    flex: 1
  },
  title: {
    fontSize: "var(--font-size-lg)",
    fontWeight: "bold",
    marginBottom: "8px",
    color: "#991B1B"
  },
  message: {
    fontSize: "var(--font-size-sm)",
    lineHeight: "1.6",
    color: "#991B1B"
  }
};









