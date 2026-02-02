import { Routes, Route, Navigate } from "react-router-dom";
import { PipelinePage } from "./pages/PipelinePage";
import { SettingsPage } from "./pages/SettingsPage";
import { ChatApp } from "./ChatApp";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/pipeline" replace />} />
      <Route path="/pipeline" element={<PipelinePage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/chat" element={<ChatApp />} />
    </Routes>
  );
}

export default App;
