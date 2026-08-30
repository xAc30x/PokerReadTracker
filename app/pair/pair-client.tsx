"use client";

import { useState } from "react";

export function PairClient() {
  const [code, setCode] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function createCode() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/mobile/pair", { method: "POST" });
      const body = (await response.json()) as { code?: string; expiresAt?: string; error?: string };
      if (!response.ok || !body.code || !body.expiresAt) {
        throw new Error(body.error ?? "Unable to create pairing code.");
      }
      setCode(body.code);
      setExpiresAt(body.expiresAt);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create pairing code.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <section style={{ width: "min(100%, 520px)", border: "1px solid rgba(127,127,127,.25)", borderRadius: 24, padding: 28 }}>
        <p style={{ margin: 0, opacity: 0.65, fontSize: 13, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase" }}>TableRead iOS</p>
        <h1 style={{ margin: "8px 0 10px", fontSize: 32 }}>Pair your iPhone</h1>
        <p style={{ margin: "0 0 20px", lineHeight: 1.5, opacity: 0.75 }}>
          Generate a one-time code while signed in, then enter it in the native TableRead app. Codes expire after 10 minutes and can only be used once.
        </p>

        {code ? (
          <div style={{ margin: "18px 0", padding: 22, borderRadius: 18, background: "rgba(127,127,127,.10)", textAlign: "center" }}>
            <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: ".18em", fontVariantNumeric: "tabular-nums" }}>{code}</div>
            <small style={{ opacity: 0.65 }}>Expires {new Date(expiresAt).toLocaleTimeString()}</small>
          </div>
        ) : null}

        <button type="button" onClick={createCode} disabled={loading} style={{ width: "100%", minHeight: 48, borderRadius: 14, fontWeight: 700, cursor: "pointer" }}>
          {loading ? "Generating…" : code ? "Generate a new code" : "Generate pairing code"}
        </button>
        {error ? <p role="alert" style={{ marginTop: 14 }}>{error}</p> : null}
      </section>
    </main>
  );
}
