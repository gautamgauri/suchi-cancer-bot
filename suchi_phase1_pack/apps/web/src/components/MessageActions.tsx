import React, { useState, useEffect, useRef } from "react";

interface MessageActionsProps {
  messageText: string;
  onFeedback?: (rating: "up" | "down") => void;
}

export const MessageActions: React.FC<MessageActionsProps> = ({
  messageText,
  onFeedback
}) => {
  const [copied, setCopied] = useState(false);
  const [feedbackGiven, setFeedbackGiven] = useState<"up" | "down" | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [ttsSupported, setTtsSupported] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    // Check if TTS is supported
    setTtsSupported(typeof window !== "undefined" && "speechSynthesis" in window);

    // Cleanup on unmount
    return () => {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(messageText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleShare = async () => {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: "Suchi Chat",
          text: messageText
        });
      } catch (err) {
        // User cancelled or error
        console.error("Share failed:", err);
      }
    } else {
      // Fallback: copy to clipboard
      handleCopy();
    }
  };

  const handleFeedback = (rating: "up" | "down") => {
    setFeedbackGiven(rating);
    onFeedback?.(rating);
  };

  const stripMarkdownAndCitations = (text: string): string => {
    // Remove citation markers like [doc:xxx::chunk:xxx]
    let cleaned = text.replace(/\[doc:[^\]]+\]/g, "");
    // Remove markdown formatting
    cleaned = cleaned.replace(/\*\*/g, ""); // Bold
    cleaned = cleaned.replace(/\*/g, ""); // Italic
    cleaned = cleaned.replace(/#{1,6}\s/g, ""); // Headers
    cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"); // Links
    cleaned = cleaned.replace(/`[^`]+`/g, ""); // Code
    // Clean up extra whitespace
    cleaned = cleaned.replace(/\s+/g, " ").trim();
    return cleaned;
  };

  const handleSpeak = () => {
    if (!ttsSupported) return;

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    const cleanText = stripMarkdownAndCitations(messageText);
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = "en-US";
    utterance.rate = 0.9; // Slightly slower for clarity

    utterance.onend = () => {
      setIsSpeaking(false);
    };

    utterance.onerror = () => {
      setIsSpeaking(false);
    };

    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
    setIsSpeaking(true);
  };

  return (
    <div style={styles.container} role="toolbar" aria-label="Message actions">
      <button
        onClick={handleCopy}
        style={styles.button}
        aria-label={copied ? "Copied" : "Copy message"}
        title={copied ? "Copied!" : "Copy to clipboard"}
      >
        {copied ? "✓ Copied" : "📋 Copy"}
      </button>
      {ttsSupported && (
        <button
          onClick={handleSpeak}
          style={{
            ...styles.button,
            ...(isSpeaking ? styles.buttonActive : {})
          }}
          aria-label={isSpeaking ? "Stop speaking" : "Read aloud"}
          title={isSpeaking ? "Stop" : "Read aloud"}
        >
          {isSpeaking ? "⏹️ Stop" : "🔊 Listen"}
        </button>
      )}
      {typeof navigator !== "undefined" && typeof navigator.share === "function" && (
        <button
          onClick={handleShare}
          style={styles.button}
          aria-label="Share message"
          title="Share message"
        >
          🔗 Share
        </button>
      )}
      <div style={styles.feedbackGroup}>
        <button
          onClick={() => handleFeedback("up")}
          style={{
            ...styles.feedbackButton,
            ...(feedbackGiven === "up" ? styles.feedbackButtonActive : {})
          }}
          aria-label="Thumbs up"
          title="Helpful"
          disabled={feedbackGiven !== null}
        >
          👍
        </button>
        <button
          onClick={() => handleFeedback("down")}
          style={{
            ...styles.feedbackButton,
            ...(feedbackGiven === "down" ? styles.feedbackButtonActive : {})
          }}
          aria-label="Thumbs down"
          title="Not helpful"
          disabled={feedbackGiven !== null}
        >
          👎
        </button>
      </div>
    </div>
  );
};

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginTop: "8px",
    opacity: 0.7,
    transition: "opacity var(--transition-base)"
  },
  button: {
    padding: "4px 8px",
    fontSize: "var(--font-size-xs)",
    backgroundColor: "transparent",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
    color: "var(--color-text-secondary)",
    transition: "var(--transition-base)",
    display: "flex",
    alignItems: "center",
    gap: "4px"
  },
  buttonActive: {
    backgroundColor: "var(--color-primary)",
    borderColor: "var(--color-primary)",
    color: "var(--color-text-on-primary)"
  },
  feedbackGroup: {
    display: "flex",
    gap: "4px",
    marginLeft: "4px"
  },
  feedbackButton: {
    padding: "4px 8px",
    fontSize: "var(--font-size-xs)",
    backgroundColor: "transparent",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
    transition: "var(--transition-base)",
    opacity: 0.7
  },
  feedbackButtonActive: {
    backgroundColor: "var(--color-primary)",
    borderColor: "var(--color-primary)",
    opacity: 1
  }
};

