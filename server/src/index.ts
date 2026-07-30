import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 3000);
const isProduction = process.env.NODE_ENV === "production";

// From server/dist/index.js (built) or server/src/index.ts (tsx), both are two
// levels below the repo root.
const clientDist = path.resolve(__dirname, "../../client/dist");

const app = express();

app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Unmatched API routes must 404 as JSON rather than falling through to the SPA.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// In development the Vite dev server owns the client and proxies /api here, so
// there is nothing static to serve.
if (isProduction) {
  if (!existsSync(clientDist)) {
    console.warn(
      `[server] client build not found at ${clientDist} — run \`npm run build\` first`,
    );
  }

  app.use(express.static(clientDist));

  // SPA fallback: any non-API route renders the client and lets it route.
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(
    `[server] listening on http://localhost:${PORT} (${isProduction ? "production" : "development"})`,
  );
});
