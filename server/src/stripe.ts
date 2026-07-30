/**
 * Stripe client. TEST MODE ONLY — see CLAUDE.md. The key is read at call time
 * rather than module load so the server still boots (and /api/health still
 * answers) when STRIPE_SECRET_KEY is absent; only the payment routes fail.
 */
import Stripe from "stripe";

let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (client) {
    return client;
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  if (!key.startsWith("sk_test_")) {
    // Guard rail: this project is test mode only. A live key here would take
    // real money from real people for a demo.
    throw new Error("STRIPE_SECRET_KEY must be a test-mode key (sk_test_...)");
  }

  client = new Stripe(key);
  return client;
}

/** Public origin used for Checkout redirect URLs. */
export function baseUrl(req: { protocol: string; get(name: string): string | undefined }): string {
  const configured = process.env.APP_BASE_URL;
  if (configured) {
    return configured.replace(/\/$/, "");
  }
  return `${req.protocol}://${req.get("host") ?? "localhost:3000"}`;
}
