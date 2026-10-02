import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// One Vite build produces both the React client (static assets) and the
// Worker (API + Apple Wallet web service).
export default defineConfig({
  plugins: [react(), cloudflare()],
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  environments: {
    // Minify the Worker bundle: smaller upload and faster isolate start-up.
    hollow_rewards: { build: { minify: true } },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
