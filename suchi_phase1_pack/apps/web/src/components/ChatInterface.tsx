import React, { useState, useEffect, useRef } from "react";
import { MessageList, Message } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { SuggestedPrompts } from "./SuggestedPrompts";
import { SafetyBanner } from "./SafetyBanner";
import { FeedbackModal } from "./FeedbackModal";
import { apiService, ChatResponse } from "../services/api";

interface ChatInterfaceProps {
  sessionId: string;
  onStartOver: () => void;
}

const SUGGESTED_PROMPTS = [
  "What are common cancer symptoms?",
  "What questions should I ask my doctor?",
  "When should I seek urgent care?",
  "How can I support a loved one with cancer?"
];

export const ChatInterface: React.FC<ChatInterfaceProps> = ({ sessionId, onStartOver }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [safetyBanner, setSafetyBanner] = useState<{
    classification: "red_flag" | "self_harm";
    message: string;
  } | null>(null);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [lastMessageId, setLastMessageId] = useState<string | null>(null);
  const [conversationEnded, setConversationEnded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async (text: string) => {
    if (conversationEnded) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      text,
      timestamp: new Date()
    };

    setMessages((prev) => [...prev, userMessage]);
    setLoading(true);

    try {
      const response: ChatResponse = await apiService.sendMessage({
        sessionId,
        channel: "web",
        userText: text
      });

      const assistantMessage: Message = {
        id: response.messageId,
        role: "assistant",
        text: response.responseText,
        timestamp: new Date()
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setLastMessageId(response.messageId);

      // Handle safety events
      if (response.safety.classification !== "normal") {
        if (response.safety.actions.includes("end_conversation")) {
          setConversationEnded(true);
        }

        if (response.safety.actions.includes("show_emergency_banner")) {
          setSafetyBanner({
            classification: response.safety.classification as "red_flag" | "self_harm",
            message: response.responseText
          });
        }
      } else {
        setSafetyBanner(null);
      }
    } catch (error) {
      console.error("Error sending message:", error);
      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        role: "assistant",
        text: "I'm sorry, there was an error processing your message. Please try again.",
        timestamp: new Date()
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const handleFeedback = async (rating: "up" | "down", reason?: string, comment?: string) => {
    if (!lastMessageId) return;

    try {
      await apiService.submitFeedback({
        sessionId,
        messageId: lastMessageId,
        rating,
        reason,
        comment
      });
    } catch (error) {
      console.error("Error submitting feedback:", error);
    }
  };

  const handlePromptSelect = (prompt: string) => {
    handleSend(prompt);
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.headerTitle}>Suchi</h1>
        <button onClick={onStartOver} style={styles.startOverButton}>
          Start Over
        </button>
      </div>

      {safetyBanner && (
        <div style={styles.bannerContainer}>
          <SafetyBanner
            classification={safetyBanner.classification}
            message={safetyBanner.message}
          />
        </div>
      )}

      <div style={styles.chatContainer}>
        <MessageList messages={messages} />
        {loading && (
          <div style={styles.loadingContainer}>
            <div style={styles.loadingMessage}>
              <div style={styles.loadingDots}>
                <div style={styles.loadingDot} className="loading-dot-1"></div>
                <div style={styles.loadingDot} className="loading-dot-2"></div>
                <div style={styles.loadingDot} className="loading-dot-3"></div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {messages.length > 0 && !conversationEnded && (
        <div style={styles.feedbackButtonContainer}>
          <button
            onClick={() => setShowFeedbackModal(true)}
            style={styles.feedbackButton}
          >
            Provide Feedback
          </button>
        </div>
      )}

      {messages.length === 0 && (
        <SuggestedPrompts prompts={SUGGESTED_PROMPTS} onSelect={handlePromptSelect} />
      )}

      <MessageInput
        onSend={handleSend}
        disabled={loading || conversationEnded}
        placeholder={conversationEnded ? "Conversation ended. Please start over." : "Type your message..."}
      />

      {showFeedbackModal && (
        <FeedbackModal
          messageId={lastMessageId || ""}
          onClose={() => setShowFeedbackModal(false)}
          onSubmit={handleFeedback}
        />
      )}
    </div>
  );
};

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    backgroundColor: "#f5f5f5"
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "16px 20px",
    backgroundColor: "white",
    borderBottom: "1px solid #dee2e6",
    boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
  },
  headerTitle: {
    fontSize: "24px",
    fontWeight: "bold",
    margin: 0,
    color: "#1a1a1a"
  },
  startOverButton: {
    padding: "8px 16px",
    fontSize: "14px",
    backgroundColor: "#6c757d",
    color: "white",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    fontWeight: "500"
  },
  bannerContainer: {
    padding: "16px 20px",
    backgroundColor: "white"
  },
  chatContainer: {
    flex: 1,
    overflowY: "auto",
    backgroundColor: "white",
    margin: "0 20px 20px 20px",
    borderRadius: "8px",
    boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
  },
  loadingContainer: {
    padding: "20px",
    display: "flex",
    justifyContent: "flex-start"
  },
  loadingMessage: {
    backgroundColor: "#f8f9fa",
    border: "1px solid #dee2e6",
    borderRadius: "12px",
    padding: "12px 16px"
  },
  loadingDots: {
    display: "flex",
    gap: "6px",
    alignItems: "center"
  },
  loadingDot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    backgroundColor: "#007bff",
    animation: "bounce 1.4s infinite ease-in-out both"
  },
  feedbackButtonContainer: {
    padding: "0 20px 12px 20px",
    display: "flex",
    justifyContent: "flex-end"
  },
  feedbackButton: {
    padding: "8px 16px",
    fontSize: "14px",
    backgroundColor: "white",
    border: "1px solid #dee2e6",
    borderRadius: "6px",
    cursor: "pointer",
    color: "#495057"
  }
};
