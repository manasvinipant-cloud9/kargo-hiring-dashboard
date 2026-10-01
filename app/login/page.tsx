"use client";
import { useEffect, useState } from "react";

export default function Login() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Open demo: there is nothing to sign in to, so go straight to the dashboard.
  useEffect(() => { fetch("/api/config").then((r) => (r.ok ? r.json() : null)).then((c) => { if (c?.openAccess) window.location.href = "/"; }).catch(() => {}); }, []);

  async function enter(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      if (r.ok) { window.location.href = "/"; return; }
      setError((await r.json().catch(() => ({}))).error || "Couldn't sign in");
    } catch {
      setError("Couldn't reach the server. Check your connection.");
    }
    setBusy(false);
  }

  return (
    <main className="login">
      <form className="card login-card" onSubmit={enter}>
        <div className="brand"><span className="logo">K</span> Kargo Hiring</div>
        <p className="muted small">Founder&apos;s dashboard for the PM and SPM shortlist. This page holds candidate details, so it is password-protected.</p>
        <label htmlFor="pw">Password</label>
        <input id="pw" type="password" autoComplete="current-password" autoFocus required value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!error} />
        {error && <p className="error small" role="alert">{error}</p>}
        <button className="btn primary" disabled={busy || !password}>{busy ? "Checking…" : "Open dashboard"}</button>
      </form>
    </main>
  );
}
