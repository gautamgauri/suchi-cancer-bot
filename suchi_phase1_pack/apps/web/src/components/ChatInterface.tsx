import React, { useState, useEffect, useRef } from "react";
import { MessageList, Message } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { SuggestedPrompts } from "./SuggestedPrompts";
import { SafetyBanner } from "./SafetyBanner";
import { FeedbackModal } from "./FeedbackModal";
import { SuchiAvatar } from "./SuchiAvatar";
import { LoadingIndicator } from "./LoadingIndicator";
import { ErrorDisplay } from "./ErrorDisplay";
import { WelcomeMessage } from "./WelcomeMessage";
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
  const [error, setError] = useState<string | null>(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Show welcome message on first visit
    const hasSeenWelcome = localStorage.getItem("suchi_welcome_seen");
    if (!hasSeenWelcome && messages.length === 0) {
      setShowWelcome(true);
    }
  }, [messages.length]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async (text: string) => {
    if (conversationEnded) return;

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/00e75a4c-076d-414b-b20f-e162c02833f6',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ChatInterface.tsx:55',message:'handleSend entry',data:{text,conversationEnded,sessionId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1,H2,H3,H4'})}).catch(()=>{});
    // #endregion

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      text,
      timestamp: new Date()
    };

    setMessages((prev) => [...prev, userMessage]);
    setLoading(true);

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/00e75a4c-076d-414b-b20f-e162c02833f6',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ChatInterface.tsx:66',message:'Before API call',data:{text,sessionId,loadingState:'true'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H2,H3,H4'})}).catch(()=>{});
    // #endregion

    try {
      const requestStartTime = Date.now();
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/00e75a4c-076d-414b-b20f-e162c02833f6',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ChatInterface.tsx:69',message:'API call starting',data:{text,sessionId},timestamp:requestStartTime,sessionId:'debug-session',runId:'run1',hypothesisId:'H2,H3,H4,H5'})}).catch(()=>{});
      // #endregion

      const response: ChatResponse = await apiService.sendMessage({
        sessionId,
        channel: "web",
        userText: text
      });

      const requestEndTime = Date.now();
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/00e75a4c-076d-414b-b20f-e162c02833f6',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ChatInterface.tsx:73',message:'API call success',data:{responseText:response.responseText?.substring(0,50),messageId:response.messageId,hasSafety:!!response.safety,latencyMs:requestEndTime-requestStartTime},timestamp:requestEndTime,sessionId:'debug-session',runId:'run1',hypothesisId:'H1,H6'})}).catch(()=>{});
      // #endregion

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

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/00e75a4c-076d-414b-b20f-e162c02833f6',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ChatInterface.tsx:99',message:'Before setLoading(false)',data:{responseReceived:true,loadingState:'still true'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
      // #endregion
    } catch (error: any) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/00e75a4c-076d-414b-b20f-e162c02833f6',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ChatInterface.tsx:106',message:'API call error',data:{errorMessage:error?.message,errorResponse:error?.response?.status,errorData:error?.response?.data,hasResponse:!!error?.response},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H2,H3,H5'})}).catch(()=>{});
      // #endregion
      console.error("Error sending message:", error);
      setError("I'm sorry, there was an error processing your message. Please try again.");
    } finally {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/00e75a4c-076d-414b-b20f-e162c02833f6',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ChatInterface.tsx:113',message:'Finally block - setLoading(false)',data:{loadingState:'false'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
      // #endregion
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
        <div style={styles.headerContent}>
          <SuchiAvatar size="medium" />
          <div style={styles.headerText}>
            <h1 style={styles.headerTitle}>Suchi</h1>
            <p style={styles.headerTagline}>Your trusted cancer information assistant</p>
          </div>
        </div>
        <button 
          onClick={onStartOver} 
          style={styles.startOverButton}
          onMouseEnter={(e) => {
            Object.assign(e.currentTarget.style, styles.startOverButtonHover);
          }}
          onMouseLeave={(e) => {
            Object.assign(e.currentTarget.style, styles.startOverButton);
          }}
          aria-label="Start new conversation"
        >
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
        <MessageList 
          messages={messages} 
          onFeedback={(messageId, rating) => {
            handleFeedback(rating);
            setLastMessageId(messageId);
          }}
        />
        {loading && (
          <LoadingIndicator />
        )}
        <div ref={messagesEndRef} />
      </div>

      {messages.length > 0 && !conversationEnded && (
        <div style={styles.feedbackButtonContainer}>
          <button
            onClick={() => setShowFeedbackModal(true)}
            style={styles.feedbackButton}
            aria-label="Provide feedback on conversation"
          >
            Provide Feedback
          </button>
        </div>
      )}

      {error && (
        <ErrorDisplay
          message={error}
          onRetry={() => {
            setError(null);
            // Retry last message if available
            if (messages.length > 0) {
              const lastUserMessage = [...messages].reverse().find(m => m.role === "user");
              if (lastUserMessage) {
                handleSend(lastUserMessage.text);
              }
            }
          }}
          onDismiss={() => setError(null)}
        />
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

      {showWelcome && (
        <WelcomeMessage
          onDismiss={() => setShowWelcome(false)}
          onGetStarted={() => {
            setShowWelcome(false);
            // Focus on input or show suggested prompts
          }}
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
    backgroundColor: "var(--color-background)"
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "16px 20px",
    backgroundColor: "var(--color-surface)",
    borderBottom: "1px solid var(--color-border)",
    boxShadow: "var(--shadow-sm)"
  },
  headerContent: {
    display: "flex",
    alignItems: "center",
    gap: "12px"
  },
  headerText: {
    display: "flex",
    flexDirection: "column",
    gap: "2px"
  },
  headerTitle: {
    fontSize: "24px",
    fontWeight: "bold",
    margin: 0,
    color: "var(--color-primary)",
    lineHeight: "1.2"
  },
  headerTagline: {
    fontSize: "var(--font-size-sm)",
    color: "var(--color-text-secondary)",
    margin: 0,
    lineHeight: "1.2"
  },
  startOverButton: {
    padding: "8px 16px",
    fontSize: "14px",
    backgroundColor: "var(--color-text-secondary)",
    color: "var(--color-text-on-primary)",
    border: "none",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
    fontWeight: "500",
    transition: "var(--transition-base)"
  },
  startOverButtonHover: {
    backgroundColor: "var(--color-text-muted)",
    transform: "translateY(-1px)",
    boxShadow: "var(--shadow-sm)"
  },
  bannerContainer: {
    padding: "16px 20px",
    backgroundColor: "var(--color-surface)"
  },
  chatContainer: {
    flex: 1,
    overflowY: "auto",
    backgroundColor: "var(--color-surface)",
    margin: "0 20px 20px 20px",
    borderRadius: "var(--radius-lg)",
    boxShadow: "var(--shadow-md)"
  },
  loadingContainer: {
    padding: "20px",
    display: "flex",
    justifyContent: "flex-start"
  },
  loadingMessage: {
    backgroundColor: "var(--color-surface-alt)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-lg)",
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
    backgroundColor: "var(--color-primary)",
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
    backgroundColor: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
    color: "var(--color-text)",
    transition: "var(--transition-base)"
  }
};
