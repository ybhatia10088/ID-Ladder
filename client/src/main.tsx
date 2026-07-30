import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Auth0Provider } from "@auth0/auth0-react";

import App from "./App";
import { fetchConfig } from "./api";
import type { Auth0Config } from "./api";
import "./styles.css";

/**
 * Auth0 settings come from the API at runtime, not from build-time VITE_ vars,
 * so the callback URL is whatever the server reports (APP_BASE_URL, or the
 * request origin) and is never hardcoded. One build runs on localhost and in
 * production unchanged.
 */
function Bootstrap() {
  const [config, setConfig] = useState<Auth0Config | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    void fetchConfig()
      .then(setConfig)
      .catch((error: unknown) =>
        setFailed(error instanceof Error ? error.message : String(error)),
      );
  }, []);

  if (failed) {
    return <div className="spinner">Could not reach the server: {failed}</div>;
  }

  if (!config) {
    return <div className="spinner">Starting up…</div>;
  }

  if (!config.domain || !config.clientId) {
    return (
      <div className="gateway">
        <div className="gateway-card">
          <h1>Sign-in is not configured</h1>
          <p>
            The server did not supply an Auth0 domain and client ID. Set AUTH0_DOMAIN and
            AUTH0_CLIENT_ID, then reload.
          </p>
        </div>
      </div>
    );
  }

  return (
    <Auth0Provider
      domain={config.domain}
      clientId={config.clientId}
      authorizationParams={{
        redirect_uri: config.redirectUri,
        scope: "openid profile email",
      }}
      // Survives the full-page redirect out to Stripe Checkout and back.
      cacheLocation="localstorage"
      onRedirectCallback={() => {
        window.history.replaceState({}, document.title, window.location.pathname);
      }}
    >
      <App />
    </Auth0Provider>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <Bootstrap />
  </StrictMode>,
);
