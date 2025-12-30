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
      />
      <button
        onClick={handleSend}
        disabled={disabled || !text.trim()}
        style={{
          ...styles.button,
          ...((disabled || !text.trim()) ? styles.buttonDisabled : {})
        }}
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
    backgroundColor: "white",
    borderTop: "1px solid #dee2e6"
  },
  input: {
    flex: 1,
    padding: "12px 16px",
    fontSize: "15px",
    border: "1px solid #dee2e6",
    borderRadius: "8px",
    resize: "none",
    fontFamily: "inherit",
    lineHeight: "1.5",
    maxHeight: "120px"
  },
  inputDisabled: {
    backgroundColor: "#f8f9fa",
    cursor: "not-allowed"
  },
  button: {
    padding: "12px 24px",
    fontSize: "15px",
    fontWeight: "600",
    color: "white",
    backgroundColor: "#007bff",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    transition: "background-color 0.2s",
    alignSelf: "flex-end"
  },
  buttonDisabled: {
    backgroundColor: "#ccc",
    cursor: "not-allowed"
  }
};





