"use client";
import { useEffect, useState } from "react";
import ThemeSwitch from "../components/ThemeSwitch";

export default function SignIn() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Open demo: there is nothing to sign in to, so go straight to the studio.
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
    <main className="g-center">
      <div className="g-corner"><ThemeSwitch /></div>
      <form className="g-signin g-glass" onSubmit={enter}>
        <div className="g-brand"><span className="g-orb" aria-hidden /><div><h1>Kargo</h1><small>Hiring Studio</small></div></div>
        <p className="g-hint">This space holds candidate details, so it is locked. Enter the access phrase to continue.</p>
        <label className="g-field" htmlFor="pw">Access phrase
          <input id="pw" type="password" autoComplete="current-password" autoFocus required value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!error} />
        </label>
        {error && <p className="g-note is-bad is-sm" role="alert">{error}</p>}
        <button className="g-btn is-main is-wide" disabled={busy || !password}>{busy ? "Checking…" : "Enter"}</button>
      </form>
    </main>
  );
}
