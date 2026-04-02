import React, { useState, useRef } from "react";

const API_BASE_URL = import.meta.env.VITE_API_URL || "/v1";

interface MessageActionsProps {
  messageText: string;
  audioUrl?: string | null;
  onFeedback?: (rating: "up" | "down") => void;
}

export const MessageActions: React.FC<MessageActionsProps> = ({
  messageText,
  audioUrl,
  onFeedback
}) => {
  const [copied, setCopied] = useState(false);
  const [feedbackGiven, setFeedbackGiven] = useState<"up" | "down" | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cachedUrlRef = useRef<string | null>(audioUrl || null);

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

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    setIsSpeaking(false);
  };

  const playAudioUrl = (url: string) => {
    const audio = new Audio(url);
    audioRef.current = audio;

    audio.onended = () => {
      setIsSpeaking(false);
    };

    audio.onerror = () => {
      setIsSpeaking(false);
      console.error("Audio playback failed");
    };

    audio.play().then(() => {
      setIsSpeaking(true);
    }).catch((err) => {
      setIsSpeaking(false);
      console.error("Audio play failed:", err);
    });
  };

  const handleSpeak = async () => {
    // If already speaking, stop
    if (isSpeaking) {
      stopAudio();
      return;
    }

    // If we already have a cached audio URL, play it directly
    if (cachedUrlRef.current) {
      playAudioUrl(cachedUrlRef.current);
      return;
    }

    // Call backend TTS endpoint
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/voice/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: messageText }),
      });

      if (!response.ok) {
        throw new Error(`TTS request failed: ${response.status}`);
      }

      const data = await response.json();
      cachedUrlRef.current = data.audioUrl;
      playAudioUrl(data.audioUrl);
    } catch (err) {
      console.error("Server TTS failed:", err);
    } finally {
      setIsLoading(false);
    }
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
      <button
        onClick={handleSpeak}
        style={{
          ...styles.button,
          ...(isSpeaking ? styles.buttonActive : {}),
          ...(isLoading ? { opacity: 0.6, cursor: "wait" } : {})
        }}
        aria-label={isSpeaking ? "Stop speaking" : isLoading ? "Loading audio" : "Read aloud"}
        title={isSpeaking ? "Stop" : isLoading ? "Loading..." : "Read aloud"}
        disabled={isLoading}
      >
        {isSpeaking ? "⏹️ Stop" : isLoading ? "⏳ Loading..." : "🔊 Listen"}
      </button>
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

