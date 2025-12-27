import React from "react";

interface SuggestedPromptsProps {
  prompts: string[];
  onSelect: (prompt: string) => void;
}

export const SuggestedPrompts: React.FC<SuggestedPromptsProps> = ({ prompts, onSelect }) => {
  if (prompts.length === 0) return null;

  return (
    <div style={styles.container}>
      <div style={styles.label}>Suggested questions:</div>
      <div style={styles.prompts}>
        {prompts.map((prompt, index) => (
          <button
            key={index}
            onClick={() => onSelect(prompt)}
            style={styles.promptButton}
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
};

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    padding: "16px 20px",
    backgroundColor: "#f8f9fa",
    borderTop: "1px solid #dee2e6"
  },
  label: {
    fontSize: "13px",
    color: "#666",
    marginBottom: "12px",
    fontWeight: "500"
  },
  prompts: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px"
  },
  promptButton: {
    padding: "8px 16px",
    fontSize: "14px",
    backgroundColor: "white",
    border: "1px solid #dee2e6",
    borderRadius: "20px",
    cursor: "pointer",
    transition: "all 0.2s",
    color: "#495057"
  }
};

