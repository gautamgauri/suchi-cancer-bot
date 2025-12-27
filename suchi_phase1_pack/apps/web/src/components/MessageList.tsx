import React from "react";
import ReactMarkdown from "react-markdown";

export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp?: Date;
}

interface MessageListProps {
  messages: Message[];
}

export const MessageList: React.FC<MessageListProps> = ({ messages }) => {
  return (
    <div style={styles.container}>
      {messages.length === 0 ? (
        <div style={styles.emptyState}>
          <p style={styles.emptyText}>Start a conversation by typing a message below.</p>
        </div>
      ) : (
        messages.map((message) => (
          <div
            key={message.id}
            style={{
              ...styles.message,
              ...(message.role === "user" ? styles.userMessage : styles.assistantMessage)
            }}
          >
            <div style={message.role === "user" ? getUserMessageStyles() : getAssistantMessageStyles()}>
              {message.role === "assistant" ? (
                <ReactMarkdown>{message.text}</ReactMarkdown>
              ) : (
                <div>{message.text}</div>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
};

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    flex: 1,
    overflowY: "auto",
    padding: "20px",
    display: "flex",
    flexDirection: "column",
    gap: "16px"
  },
  emptyState: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    height: "100%",
    color: "#999"
  },
  emptyText: {
    fontSize: "16px"
  },
  message: {
    display: "flex",
    maxWidth: "80%",
    animation: "fadeIn 0.3s ease-in"
  },
  userMessage: {
    alignSelf: "flex-end",
    marginLeft: "auto"
  },
  assistantMessage: {
    alignSelf: "flex-start"
  },
  messageContent: {
    padding: "12px 16px",
    borderRadius: "12px",
    fontSize: "15px",
    lineHeight: "1.6",
    wordWrap: "break-word"
  }
};

// Dynamic styles for user vs assistant messages
const getUserMessageStyles = (): React.CSSProperties => ({
  ...styles.messageContent,
  backgroundColor: "#007bff",
  color: "white"
});

const getAssistantMessageStyles = (): React.CSSProperties => ({
  ...styles.messageContent,
  backgroundColor: "#f8f9fa",
  color: "#333",
  border: "1px solid #dee2e6"
});
};
