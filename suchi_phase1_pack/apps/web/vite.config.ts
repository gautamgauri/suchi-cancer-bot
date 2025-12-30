import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      "/v1": {
        target: "http://localhost:3001",
        changeOrigin: true
      }
    }
  },
  // Production build configuration
  build: {
    outDir: "dist",
    sourcemap: false,
    // Ensure environment variables are available at build time
    envPrefix: "VITE_"
  },
  // Define environment variables for build-time replacement
  define: {
    // VITE_API_URL will be replaced at build time if set as env var
    // If not set, falls back to relative path "/v1" (already handled in src/services/api.ts)
  }
});




