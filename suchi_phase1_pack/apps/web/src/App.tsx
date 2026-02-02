import { Routes, Route, Navigate } from "react-router-dom";
import { PipelinePage } from "./pages/PipelinePage";
import { SettingsPage } from "./pages/SettingsPage";
import { ChatApp } from "./ChatApp";

function App() {
  // Default route based on environment - Suchi chat for suchi-web, Pipeline for funding
  const isFundingApp = window.location.hostname.includes('funding') ||
                       import.meta.env.VITE_APP_MODE === 'funding';

  return (
    <Routes>
      <Route path="/" element={<Navigate to={isFundingApp ? "/pipeline" : "/chat"} replace />} />
      <Route path="/pipeline" element={<PipelinePage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/chat" element={<ChatApp />} />
    </Routes>
  );
}

export default App;
