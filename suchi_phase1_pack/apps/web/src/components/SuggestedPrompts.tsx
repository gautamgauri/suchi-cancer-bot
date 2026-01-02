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
            onMouseEnter={(e) => {
              Object.assign(e.currentTarget.style, styles.promptButtonHover);
            }}
            onMouseLeave={(e) => {
              Object.assign(e.currentTarget.style, styles.promptButton);
            }}
            aria-label={`Suggested prompt: ${prompt}`}
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
    backgroundColor: "var(--color-surface-alt)",
    borderTop: "1px solid var(--color-border)"
  },
  label: {
    fontSize: "var(--font-size-sm)",
    color: "var(--color-text-secondary)",
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
    fontSize: "var(--font-size-sm)",
    backgroundColor: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-full)",
    cursor: "pointer",
    transition: "var(--transition-base)",
    color: "var(--color-text)"
  },
  promptButtonHover: {
    backgroundColor: "var(--color-primary)",
    color: "var(--color-text-on-primary)",
    borderColor: "var(--color-primary)",
    transform: "translateY(-1px)",
    boxShadow: "var(--shadow-sm)"
  }
};









