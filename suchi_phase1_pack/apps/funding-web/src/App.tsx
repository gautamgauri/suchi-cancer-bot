import { Routes, Route, Navigate } from "react-router-dom";
import { PipelinePage } from "./pages/PipelinePage";
import { SettingsPage } from "./pages/SettingsPage";
import { FrameworkLibraryPage } from "./pages/FrameworkLibraryPage";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/pipeline" replace />} />
      <Route path="/pipeline" element={<PipelinePage />} />
      <Route path="/framework" element={<FrameworkLibraryPage />} />
      <Route path="/settings" element={<SettingsPage />} />
    </Routes>
  );
}

export default App;
