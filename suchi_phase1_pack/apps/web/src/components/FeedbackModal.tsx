import React, { useState } from "react";

interface FeedbackModalProps {
  messageId: string;
  onClose: () => void;
  onSubmit: (rating: "up" | "down", reason?: string, comment?: string) => void;
}

export const FeedbackModal: React.FC<FeedbackModalProps> = ({ onClose, onSubmit }) => {
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (rating) {
      onSubmit(rating, reason || undefined, comment || undefined);
      onClose();
    }
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>Feedback</h2>
          <button onClick={onClose} style={styles.closeButton}>
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.ratingSection}>
            <label style={styles.label}>Was this response helpful?</label>
            <div style={styles.ratingButtons}>
              <button
                type="button"
                onClick={() => setRating("up")}
                style={{
                  ...styles.ratingButton,
                  ...(rating === "up" ? styles.ratingButtonActive : {})
                }}
              >
                👍 Yes
              </button>
              <button
                type="button"
                onClick={() => setRating("down")}
                style={{
                  ...styles.ratingButton,
                  ...(rating === "down" ? styles.ratingButtonActive : {})
                }}
              >
                👎 No
              </button>
            </div>
          </div>

          {rating === "down" && (
            <div style={styles.reasonSection}>
              <label style={styles.label}>Reason (optional)</label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                style={styles.select}
              >
                <option value="">Select a reason</option>
                <option value="incorrect">Incorrect information</option>
                <option value="unhelpful">Not helpful</option>
                <option value="incomplete">Incomplete answer</option>
                <option value="other">Other</option>
              </select>
            </div>
          )}

          <div style={styles.commentSection}>
            <label style={styles.label}>Additional comments (optional)</label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              style={styles.textarea}
              rows={3}
              placeholder="Share your feedback..."
            />
          </div>

          <div style={styles.actions}>
            <button type="button" onClick={onClose} style={styles.cancelButton}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={!rating}
              style={{
                ...styles.submitButton,
                ...(!rating ? styles.submitButtonDisabled : {})
              }}
            >
              Submit
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const styles: { [key: string]: React.CSSProperties } = {
  overlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
    padding: "20px"
  },
  modal: {
    backgroundColor: "white",
    borderRadius: "12px",
    maxWidth: "500px",
    width: "100%",
    maxHeight: "90vh",
    overflowY: "auto"
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "20px",
    borderBottom: "1px solid #dee2e6"
  },
  title: {
    fontSize: "20px",
    fontWeight: "bold",
    margin: 0
  },
  closeButton: {
    background: "none",
    border: "none",
    fontSize: "32px",
    cursor: "pointer",
    color: "#666",
    lineHeight: 1
  },
  form: {
    padding: "20px",
    display: "flex",
    flexDirection: "column",
    gap: "20px"
  },
  ratingSection: {
    display: "flex",
    flexDirection: "column",
    gap: "12px"
  },
  label: {
    fontSize: "14px",
    fontWeight: "600",
    color: "#333"
  },
  ratingButtons: {
    display: "flex",
    gap: "12px"
  },
  ratingButton: {
    flex: 1,
    padding: "12px",
    fontSize: "16px",
    border: "2px solid #dee2e6",
    borderRadius: "8px",
    backgroundColor: "white",
    cursor: "pointer",
    transition: "all 0.2s"
  },
  ratingButtonActive: {
    borderColor: "#007bff",
    backgroundColor: "#e7f3ff"
  },
  reasonSection: {
    display: "flex",
    flexDirection: "column",
    gap: "8px"
  },
  select: {
    padding: "10px",
    fontSize: "14px",
    border: "1px solid #dee2e6",
    borderRadius: "8px"
  },
  commentSection: {
    display: "flex",
    flexDirection: "column",
    gap: "8px"
  },
  textarea: {
    padding: "10px",
    fontSize: "14px",
    border: "1px solid #dee2e6",
    borderRadius: "8px",
    fontFamily: "inherit",
    resize: "vertical"
  },
  actions: {
    display: "flex",
    gap: "12px",
    justifyContent: "flex-end"
  },
  cancelButton: {
    padding: "10px 20px",
    fontSize: "14px",
    border: "1px solid #dee2e6",
    borderRadius: "8px",
    backgroundColor: "white",
    cursor: "pointer"
  },
  submitButton: {
    padding: "10px 20px",
    fontSize: "14px",
    border: "none",
    borderRadius: "8px",
    backgroundColor: "#007bff",
    color: "white",
    cursor: "pointer",
    fontWeight: "600"
  },
  submitButtonDisabled: {
    backgroundColor: "#ccc",
    cursor: "not-allowed"
  }
};





