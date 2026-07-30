/**
 * Loads the repo-root .env into process.env for local development.
 *
 * Railway injects real environment variables, so anything already set wins —
 * this only fills gaps. Hand-rolled rather than adding a dependency, since the
 * format we need is just KEY=VALUE.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// server/src -> repo root, and server/dist -> repo root.
const ENV_PATH = path.resolve(__dirname, "../../.env");

export function loadEnv(): void {
  if (!existsSync(ENV_PATH)) {
    return;
  }

  for (const line of readFileSync(ENV_PATH, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    // Never clobber a real environment variable.
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
