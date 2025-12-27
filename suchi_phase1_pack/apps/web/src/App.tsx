import React, { useState, useEffect } from "react";
import { ConsentGate } from "./components/ConsentGate";
import { ChatInterface } from "./components/ChatInterface";
import { apiService } from "./services/api";

function App() {
  const [hasConsented, setHasConsented] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
      const response = await apiService.createSession({
        channel: "web",
        locale: "en"
      });
      setSessionId(response.sessionId);
      setLoading(false);
    } catch (error) {
      console.error("Error creating session:", error);
      setLoading(false);
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
    return <ConsentGate onAccept={handleConsent} />;
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

