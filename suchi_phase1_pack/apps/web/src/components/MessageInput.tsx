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
  const recognitionRef = useRef<SpeechRecognition | null>(null);

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
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = "";
      let interimTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interimTranscript += result[0].transcript;
        }
      }

      // Update text with final transcript, show interim in real-time
      if (finalTranscript) {
        setText((prev) => prev + finalTranscript);
      } else if (interimTranscript) {
        // Show interim results visually (optional)
      }
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

  const toggleRecording = () => {
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
      {speechSupported && (
        <button
          onClick={toggleRecording}
          disabled={disabled}
          style={{
            ...styles.micButton,
            ...(isRecording ? styles.micButtonRecording : {}),
            ...(disabled ? styles.buttonDisabled : {})
          }}
          aria-label={isRecording ? "Stop recording" : "Start voice input"}
          title={isRecording ? "Stop recording" : "Voice input"}
        >
          {isRecording ? "🔴" : "🎤"}
        </button>
      )}
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
  },
  micButton: {
    padding: "12px 16px",
    fontSize: "18px",
    backgroundColor: "var(--color-surface-alt)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
    transition: "var(--transition-base)",
    alignSelf: "flex-end",
    display: "flex",
    alignItems: "center",
    justifyContent: "center"
  },
  micButtonRecording: {
    backgroundColor: "var(--color-error-bg)",
    borderColor: "var(--color-error)",
    animation: "pulse 1s infinite"
  }
};









