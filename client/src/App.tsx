import { useEffect, useState } from "react";

type Health = { status: string };

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Relative path: proxied to Express in dev, same origin in production.
    fetch("/api/health")
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Request failed: ${res.status}`);
        }
        return res.json() as Promise<Health>;
      })
      .then(setHealth)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  return (
    <main>
      <h1>ID-Ladder</h1>
      <p>
        API health:{" "}
        {error ? (
          <strong>unreachable ({error})</strong>
        ) : health ? (
          <strong>{health.status}</strong>
        ) : (
          "checking…"
        )}
      </p>
    </main>
  );
}
