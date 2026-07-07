import { useState, useEffect } from "react";
import { ConsentGate } from "./components/ConsentGate";
import { ChatInterface } from "./components/ChatInterface";
import { apiService, UserRole } from "./services/api";

export function ChatApp() {
  const [hasConsented, setHasConsented] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<UserRole | null>(null);

  useEffect(() => {
    const consented = sessionStorage.getItem("suchi_consented");
    if (consented === "true") {
      setHasConsented(true);
      createSession();
    } else {
      setLoading(false);
    }
  }, []);

  const createSession = async (userRole: UserRole = "unknown") => {
    try {
      setError(null);
      setLoading(true);
      const response = await apiService.createSession({
        channel: "web",
        locale: "en",
        userRole,
      });
      setSessionId(response.sessionId);
      setLoading(false);
    } catch (err: unknown) {
      console.error("Error creating session:", err);
      const errorMessage =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { message?: string } }; message?: string }).response?.data?.message ||
            (err as { message?: string }).message
          : "Failed to connect to server. Please try again.";
      setError(String(errorMessage));
      setLoading(false);
      sessionStorage.removeItem("suchi_consented");
      setHasConsented(false);
    }
  };

  const handleConsent = () => {
    sessionStorage.setItem("suchi_consented", "true");
    setHasConsented(true);
    setLoading(false);
  };

  const handleRoleSelected = (role: UserRole) => {
    setPendingRole(role);
    createSession(role);
  };

  const handleStartOver = () => {
    sessionStorage.removeItem("suchi_consented");
    setHasConsented(false);
    setSessionId(null);
    setPendingRole(null);
    setLoading(true);
    setTimeout(() => setLoading(false), 100);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-lg text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!hasConsented) {
    return <ConsentGate onAccept={handleConsent} error={error ?? undefined} />;
  }

  return (
    <ChatInterface
      sessionId={sessionId}
      onStartOver={handleStartOver}
      onRoleSelected={!sessionId ? handleRoleSelected : undefined}
      sessionCreating={!sessionId && pendingRole !== null}
    />
  );
}
