import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Mesmo código para web (Vercel) e desktop (Tauri).
// `vite --mode desktop` carrega .env.desktop (VITE_PLATFORM=desktop).
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  envPrefix: ["VITE_"],
  build: {
    target: mode === "desktop" ? "chrome105" : "es2020",
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
}));
