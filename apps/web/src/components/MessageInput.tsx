import React, { useState, KeyboardEvent, useRef, useEffect } from "react";

// Web Speech API types
interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}

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
  const [isRecording, setIsRecording] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [showUnsupportedTooltip, setShowUnsupportedTooltip] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const baseTextRef = useRef<string>("");

  useEffect(() => {
    // Check if Web Speech API is supported
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    setSpeechSupported(!!SpeechRecognition);
  }, []);

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

  const startRecording = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    // Capture whatever text is already in the input before recording
    baseTextRef.current = text;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = "";
      let interimTranscript = "";

      // Iterate over ALL results, not just from resultIndex,
      // because event.results accumulates all previous results
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interimTranscript += result[0].transcript;
        }
      }

      // Replace (not append) — show base text + full transcript so far
      setText(baseTextRef.current + finalTranscript + interimTranscript);
    };

    recognition.onerror = (event: { error: string }) => {
      console.error("Speech recognition error:", event.error);
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  };

  const stopRecording = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsRecording(false);
  };

  const handleMicClick = () => {
    if (!speechSupported) {
      // Show tooltip briefly for unsupported browsers
      setShowUnsupportedTooltip(true);
      setTimeout(() => setShowUnsupportedTooltip(false), 3000);
      return;
    }
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
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
      <div style={styles.micContainer}>
        <button
          onClick={handleMicClick}
          disabled={disabled}
          style={{
            ...styles.micButton,
            ...(isRecording ? styles.micButtonRecording : {}),
            ...(!speechSupported ? styles.micButtonUnsupported : {}),
            ...(disabled ? styles.buttonDisabled : {})
          }}
          aria-label={
            !speechSupported
              ? "Voice input not supported in this browser"
              : isRecording
              ? "Stop recording"
              : "Start voice input"
          }
          title={
            !speechSupported
              ? "Voice input — use Chrome or Edge for best support"
              : isRecording
              ? "Stop recording"
              : "Voice input"
          }
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke={isRecording ? "#dc2626" : "currentColor"}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </button>
        {showUnsupportedTooltip && (
          <div style={styles.tooltip}>
            Voice input works best in Chrome or Edge
          </div>
        )}
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
    borderTop: "1px solid var(--color-border)",
    alignItems: "flex-end"
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
  },
  micContainer: {
    position: "relative" as const,
    display: "flex",
    alignItems: "flex-end"
  },
  micButton: {
    padding: "12px 14px",
    fontSize: "18px",
    backgroundColor: "var(--color-surface-alt)",
    border: "2px solid var(--color-primary)",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
    transition: "var(--transition-base)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--color-primary)"
  },
  micButtonRecording: {
    backgroundColor: "#fef2f2",
    borderColor: "#dc2626",
    color: "#dc2626",
    animation: "pulse 1s infinite"
  },
  micButtonUnsupported: {
    borderColor: "var(--color-border)",
    color: "var(--color-text-muted)",
    opacity: 0.6,
    cursor: "pointer"
  },
  tooltip: {
    position: "absolute" as const,
    bottom: "100%",
    left: "50%",
    transform: "translateX(-50%)",
    marginBottom: "8px",
    padding: "6px 12px",
    backgroundColor: "var(--color-text)",
    color: "var(--color-surface)",
    fontSize: "12px",
    borderRadius: "6px",
    whiteSpace: "nowrap" as const,
    zIndex: 10
  }
};
