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
        backgroundColor: isEmergency ? "#f8d7da" : "#fff3cd",
        borderColor: isEmergency ? "#f5c6cb" : "#ffeaa7"
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
    fontSize: "18px",
    fontWeight: "bold",
    marginBottom: "8px",
    color: "#721c24"
  },
  message: {
    fontSize: "14px",
    lineHeight: "1.6",
    color: "#721c24"
  }
};





