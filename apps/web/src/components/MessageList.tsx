import React from "react";
import ReactMarkdown from "react-markdown";
import { SuchiAvatar } from "./SuchiAvatar";
import { MessageActions } from "./MessageActions";
import { removeCitationMarkers } from "../utils/citationParser";
import { formatRelativeTime } from "../utils/timeUtils";

export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp?: Date;
  /**
   * False for a bubble the client composed itself, with no stored message
   * behind it (the issue #171 timeout fallback). Rating such a bubble would
   * attach the feedback to whatever answer came before it. Defaults to true.
   */
  rateable?: boolean;
}

interface MessageListProps {
  messages: Message[];
  onFeedback?: (messageId: string, rating: "up" | "down") => void;
}

export const MessageList: React.FC<MessageListProps> = ({ messages, onFeedback }) => {
  /**
   * Assistant text is rendered as markdown with every citation marker removed.
   *
   * Citations are an audit artifact (#54): the API strips `[citation:…]`
   * markers before the response leaves the server, and the structured
   * `citations` array it returns carries only doc/chunk ids — no title or URL
   * a reader could follow. So there is nothing verifiable to show per answer,
   * and this component deliberately shows no per-answer source list (#90).
   *
   * The strip here is the client's fail-closed backstop (#68): if a marker ever
   * reaches the client — complete, unterminated or truncated — it is dropped
   * rather than rendered as "[1]" / "Source 1" pointing at nothing.
   */
  const renderAssistantText = (text: string) => (
    <div>
      <ReactMarkdown>{removeCitationMarkers(text)}</ReactMarkdown>
    </div>
  );

  return (
    <div style={styles.container} role="log" aria-live="polite" aria-label="Chat messages">
      {messages.length === 0 ? (
        <div style={styles.emptyState}>
          <SuchiAvatar size="large" />
          <p style={styles.emptyText}>Start a conversation by typing a message below.</p>
          <p style={styles.emptySubtext}>
            I'm here to help you understand cancer-related information and navigate your questions.
          </p>
        </div>
      ) : (
        messages.map((message) => (
          <div
            key={message.id}
            style={{
              ...styles.message,
              ...(message.role === "user" ? styles.userMessage : styles.assistantMessage)
            }}
            role={message.role === "user" ? "user" : "assistant"}
            aria-label={`${message.role} message`}
          >
            {message.role === "assistant" && (
              <div style={styles.avatarContainer}>
                <SuchiAvatar size="small" />
              </div>
            )}
            <div style={styles.messageContentWrapper}>
              <div style={message.role === "user" ? getUserMessageStyles() : getAssistantMessageStyles()}>
                {message.role === "assistant" ? (
                  renderAssistantText(message.text)
                ) : (
                  <div>{message.text}</div>
                )}
              </div>
              {message.timestamp && (
                <div style={styles.timestamp} aria-label={`Sent ${formatRelativeTime(message.timestamp)}`}>
                  {formatRelativeTime(message.timestamp)}
                </div>
              )}
              {message.role === "assistant" && (
                <MessageActions
                  messageText={message.text}
                  showFeedback={message.rateable !== false}
                  onFeedback={(rating) => onFeedback?.(message.id, rating)}
                />
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
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    height: "100%",
    gap: "16px",
    color: "var(--color-text-secondary)"
  },
  emptyText: {
    fontSize: "var(--font-size-lg)",
    fontWeight: "500",
    color: "var(--color-text)"
  },
  emptySubtext: {
    fontSize: "var(--font-size-sm)",
    color: "var(--color-text-secondary)",
    textAlign: "center",
    maxWidth: "400px"
  },
  message: {
    display: "flex",
    maxWidth: "80%",
    animation: "fadeIn 0.3s ease-in",
    gap: "12px"
  },
  userMessage: {
    alignSelf: "flex-end",
    marginLeft: "auto"
  },
  assistantMessage: {
    alignSelf: "flex-start"
  },
  avatarContainer: {
    flexShrink: 0
  },
  messageContentWrapper: {
    display: "flex",
    flexDirection: "column",
    flex: 1
  },
  messageContent: {
    padding: "12px 16px",
    borderRadius: "var(--radius-lg)",
    fontSize: "var(--font-size-base)",
    lineHeight: "1.6",
    wordWrap: "break-word"
  },
  timestamp: {
    fontSize: "var(--font-size-xs)",
    color: "var(--color-text-muted)",
    marginTop: "4px",
    marginLeft: "4px"
  }
};

// Dynamic styles for user vs assistant messages
const getUserMessageStyles = (): React.CSSProperties => ({
  ...styles.messageContent,
  backgroundColor: "var(--color-primary)",
  color: "var(--color-text-on-primary)"
});

const getAssistantMessageStyles = (): React.CSSProperties => ({
  ...styles.messageContent,
  backgroundColor: "var(--color-surface-alt)",
  color: "var(--color-text)",
  border: "1px solid var(--color-border)"
});
