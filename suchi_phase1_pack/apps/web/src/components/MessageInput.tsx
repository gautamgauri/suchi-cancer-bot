import React, { useState, KeyboardEvent } from "react";

interface MessageInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export const MessageInput: React.FC<MessageInputProps> = ({
  onSend,
  disabled = false,
  placeholder = "Type your message..."
}) => {
  const [text, setText] = useState("");

  const handleSend = () => {
    const trimmed = text.trim();
    if (trimmed && !disabled) {
      onSend(trimmed);
      setText("");
    }
  };

  const handleKeyPress = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div style={styles.container}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyPress={handleKeyPress}
        disabled={disabled}
        placeholder={placeholder}
        style={{
          ...styles.input,
          ...(disabled ? styles.inputDisabled : {})
        }}
        rows={1}
        aria-label="Message input"
        aria-describedby="input-help"
        role="textbox"
      />
      <div id="input-help" style={{ display: "none" }}>
        Type your message and press Enter to send, or Shift+Enter for a new line
      </div>
      <button
        onClick={handleSend}
        disabled={disabled || !text.trim()}
        style={{
          ...styles.button,
          ...((disabled || !text.trim()) ? styles.buttonDisabled : {})
        }}
        onMouseEnter={(e) => {
          if (!disabled && text.trim()) {
            Object.assign(e.currentTarget.style, styles.buttonHover);
          }
        }}
        onMouseLeave={(e) => {
          if (!disabled && text.trim()) {
            Object.assign(e.currentTarget.style, styles.button);
          }
        }}
        aria-label="Send message"
      >
        Send
      </button>
    </div>
  );
};

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    display: "flex",
    gap: "12px",
    padding: "20px",
    backgroundColor: "var(--color-surface)",
    borderTop: "1px solid var(--color-border)"
  },
  input: {
    flex: 1,
    padding: "12px 16px",
    fontSize: "var(--font-size-base)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-md)",
    resize: "none",
    fontFamily: "var(--font-family)",
    lineHeight: "1.5",
    maxHeight: "120px",
    backgroundColor: "var(--color-surface)",
    color: "var(--color-text)"
  },
  inputDisabled: {
    backgroundColor: "var(--color-surface-alt)",
    cursor: "not-allowed",
    opacity: 0.6
  },
  button: {
    padding: "12px 24px",
    fontSize: "var(--font-size-base)",
    fontWeight: "600",
    color: "var(--color-action-text)",
    backgroundColor: "var(--color-action)",
    border: "none",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
    transition: "var(--transition-base)",
    alignSelf: "flex-end"
  },
  buttonHover: {
    backgroundColor: "var(--color-action-hover)",
    transform: "translateY(-1px)",
    boxShadow: "var(--shadow-md)"
  },
  buttonDisabled: {
    backgroundColor: "var(--color-text-muted)",
    cursor: "not-allowed",
    opacity: 0.5
  }
};









