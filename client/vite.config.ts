import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const SERVER_PORT = process.env.PORT ?? "3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Client code always calls the API with relative paths; in dev those are
    // proxied to Express, in production Express serves both from one origin.
    proxy: {
      "/api": {
        target: `http://localhost:${SERVER_PORT}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
