import React, { useState, useEffect } from "react";
import { ConsentGate } from "./components/ConsentGate";
import { ChatInterface } from "./components/ChatInterface";
import { apiService } from "./services/api";

function App() {
  const [hasConsented, setHasConsented] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check if user has already consented in this session
    const consented = sessionStorage.getItem("suchi_consented");
    if (consented === "true") {
      setHasConsented(true);
      createSession();
    } else {
      setLoading(false);
    }
  }, []);

  const createSession = async () => {
    try {
      setError(null);
      setLoading(true);
      const response = await apiService.createSession({
        channel: "web",
        locale: "en"
      });
      setSessionId(response.sessionId);
      setLoading(false);
    } catch (error: any) {
      console.error("Error creating session:", error);
      const errorMessage = error.response?.data?.message || error.message || "Failed to connect to server. Please try again.";
      setError(errorMessage);
      setLoading(false);
      // Clear consent on session creation failure
      sessionStorage.removeItem("suchi_consented");
      setHasConsented(false);
    }
  };

  const handleConsent = () => {
    sessionStorage.setItem("suchi_consented", "true");
    setHasConsented(true);
    createSession();
  };

  const handleStartOver = () => {
    sessionStorage.removeItem("suchi_consented");
    setHasConsented(false);
    setSessionId(null);
    setLoading(true);
    setTimeout(() => setLoading(false), 100);
  };

  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.loadingText}>Loading...</div>
      </div>
    );
  }

  if (!hasConsented || !sessionId) {
    return <ConsentGate onAccept={handleConsent} error={error} />;
  }

  return <ChatInterface sessionId={sessionId} onStartOver={handleStartOver} />;
}

const styles: { [key: string]: React.CSSProperties } = {
  loadingContainer: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    minHeight: "100vh",
    fontSize: "18px",
    color: "#666"
  },
  loadingText: {
    // Loading text styling
  }
};

export default App;

















