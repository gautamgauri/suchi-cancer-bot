import React from "react";
import ReactMarkdown from "react-markdown";
import { SuchiAvatar } from "./SuchiAvatar";
import { Citation, CitationData } from "./Citation";
import { MessageActions } from "./MessageActions";
import { parseCitations, splitTextWithCitations, toCitationData } from "../utils/citationParser";
import { formatRelativeTime } from "../utils/timeUtils";

export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp?: Date;
}

interface MessageListProps {
  messages: Message[];
  onFeedback?: (messageId: string, rating: "up" | "down") => void;
}

export const MessageList: React.FC<MessageListProps> = ({ messages, onFeedback }) => {
  const renderMessageWithCitations = (text: string) => {
    const citations = parseCitations(text);
    const parts = splitTextWithCitations(text);
    const citationMap = new Map<string, CitationData>();

    // Build citation map
    citations.forEach((citation) => {
      const key = `${citation.docId}:${citation.chunkId}`;
      if (!citationMap.has(key)) {
        citationMap.set(key, toCitationData(citation, citationMap.size));
      }
    });

    return (
      <div>
        {parts.map((part, index) => {
          if (part.type === "citation" && part.citation) {
            const key = `${part.citation.docId}:${part.citation.chunkId}`;
            const citationData = citationMap.get(key);
            if (citationData) {
              const citationIndex = Array.from(citationMap.keys()).indexOf(key);
              return (
                <Citation
                  key={`citation-${index}`}
                  citation={citationData}
                  index={citationIndex}
                />
              );
            }
          }
          return (
            <ReactMarkdown key={`text-${index}`}>
              {part.content}
            </ReactMarkdown>
          );
        })}
        {citations.length > 0 && (
          <div style={styles.sourcesSection}>
            <div style={styles.sourcesHeader}>
              Sources ({citations.length})
            </div>
            <div style={styles.sourcesList}>
              {Array.from(citationMap.values()).map((citation, index) => (
                <div key={index} style={styles.sourceItem}>
                  <span style={styles.sourceNumber}>[{index + 1}]</span>
                  <span style={styles.sourceTitle}>{citation.title}</span>
                  {citation.url && (
                    <a
                      href={citation.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={styles.sourceLink}
                    >
                      View →
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

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
                  renderMessageWithCitations(message.text)
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
  },
  sourcesSection: {
    marginTop: "16px",
    paddingTop: "16px",
    borderTop: "1px solid var(--color-border)"
  },
  sourcesHeader: {
    fontSize: "var(--font-size-sm)",
    fontWeight: "600",
    color: "var(--color-text)",
    marginBottom: "8px"
  },
  sourcesList: {
    display: "flex",
    flexDirection: "column",
    gap: "6px"
  },
  sourceItem: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "var(--font-size-sm)",
    color: "var(--color-text-secondary)"
  },
  sourceNumber: {
    fontWeight: "600",
    color: "var(--color-primary)"
  },
  sourceTitle: {
    flex: 1
  },
  sourceLink: {
    color: "var(--color-primary)",
    textDecoration: "none",
    fontSize: "var(--font-size-xs)"
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
