"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Role } from "@/lib/rubric";
import { roleName } from "@/lib/fill";
import type { AppConfig, Candidate, Decision } from "@/lib/types";
import UploadCard, { type QueueItem } from "./components/UploadCard";
import CandidateTable from "./components/CandidateTable";
import Drawer from "./components/Drawer";
import SendModal from "./components/SendModal";
import { Modal, Stat } from "./components/ui";

type Filter = "all" | "pending" | "invite" | "reject" | "attention";
const scoreFor = (c: Candidate, r: Role) => (r === "PM" ? c.pm_score : c.spm_score) ?? 0;
const needsAttention = (c: Candidate) => c.status === "error" || !!c.stalled;
const sendable = (c: Candidate) => c.status === "scored" && c.decision !== "pending" && c.email_status !== "sent";
const CONCURRENCY = 3;

async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: "no-store", ...init });
  if (r.status === 401 && !url.startsWith("/api/login")) { window.location.href = "/login"; throw new Error("Signed out"); }
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j as T;
}
const post = <T,>(url: string, body?: unknown) =>
  api<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

export default function Dashboard() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [config, setConfig] = useState<AppConfig>({ emailConfigured: true, testRedirect: null, reviewAvailable: false, openAccess: false, geminiConfigured: true });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Role>("PM");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploadRole, setUploadRole] = useState<Role | "AUTO">("PM");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [modal, setModal] = useState<null | { kind: "send"; ids: string[] } | { kind: "accept" } | { kind: "remove"; id: string }>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const nextQueueId = useRef(1);

  const flash = useCallback((m: string) => { setToast(m); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 4000); }, []);

  const load = useCallback(async () => {
    try { setCandidates(await api<Candidate[]>("/api/candidates")); setLoadError(null); }
    catch (e) { setLoadError(e instanceof Error ? e.message : String(e)); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); api<AppConfig>("/api/config").then(setConfig).catch(() => {}); }, [load]);

  // Rows being scored (possibly from another tab or an earlier session) refresh themselves until they finish.
  const scoringNow = candidates.some((c) => c.status === "processing" && !c.stalled);
  useEffect(() => { if (!scoringNow) return; const t = setInterval(load, 4000); return () => clearInterval(t); }, [scoringNow, load]);

  // ---- upload (3 at a time) -------------------------------------------------------------------
  async function processFiles(files: File[]) {
    const role = uploadRole;
    const items: QueueItem[] = files.map((f) => ({ id: nextQueueId.current++, name: f.name, state: "waiting" }));
    setQueue((q) => [...q, ...items]);
    const set = (id: number, patch: Partial<QueueItem>) => setQueue((q) => q.map((it) => (it.id === id ? { ...it, ...patch } : it)));
    let next = 0;
    const worker = async () => {
      while (next < files.length) {
        const i = next++;
        set(items[i].id, { state: "working" });
        const fd = new FormData();
        fd.append("file", files[i]);
        fd.append("role", role);
        try {
          const r = await fetch("/api/process", { method: "POST", body: fd });
          const j = await r.json().catch(() => ({}));
          if (r.status === 401) { window.location.href = "/login"; return; }
          if (r.ok && j.duplicate) set(items[i].id, { state: "dup", msg: `already added${j.name ? ` (${j.name})` : ""}` });
          else if (r.ok) set(items[i].id, { state: "done", msg: `${j.name || "Candidate"} · ${j.role} fit ${j.score}${j.noEmail ? " · no email found" : ""}` });
          else set(items[i].id, { state: "error", msg: j.error || `HTTP ${r.status}` });
        } catch (e) {
          set(items[i].id, { state: "error", msg: e instanceof Error ? e.message : String(e) });
        }
        load();
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));
    load();
  }

  // ---- derived lists --------------------------------------------------------------------------
  const roleRows = useMemo(() => candidates.filter((c) => c.applied_role === tab), [candidates, tab]);

  // Rank among everyone scored for the role, so filtering never renumbers anybody.
  const ranks = useMemo(() => {
    const m = new Map<string, number>();
    for (const role of ["PM", "SPM"] as Role[]) {
      candidates.filter((c) => c.applied_role === role && c.status === "scored")
        .sort((a, b) => scoreFor(b, role) - scoreFor(a, role) || a.created_at.localeCompare(b.created_at))
        .forEach((c, i) => m.set(c.id, i + 1));
    }
    return m;
  }, [candidates]);

  const filterCounts = useMemo(() => ({
    all: roleRows.length,
    pending: roleRows.filter((c) => c.status === "scored" && c.decision === "pending").length,
    invite: roleRows.filter((c) => c.decision === "invite").length,
    reject: roleRows.filter((c) => c.decision === "reject").length,
    attention: roleRows.filter(needsAttention).length,
  }), [roleRows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const order = (c: Candidate) => (c.status === "scored" ? 0 : c.status === "processing" && !c.stalled ? 1 : 2);
    return roleRows
      .filter((c) => !q || `${c.full_name ?? ""} ${c.file_name} ${c.summary ?? ""}`.toLowerCase().includes(q))
      .filter((c) => filter === "all" || (filter === "pending" ? c.status === "scored" && c.decision === "pending" : filter === "attention" ? needsAttention(c) : c.decision === filter))
      .sort((a, b) => order(a) - order(b) || (order(a) === 0 ? scoreFor(b, tab) - scoreFor(a, tab) : 0) || a.created_at.localeCompare(b.created_at));
  }, [roleRows, filter, query, tab]);

  const stats = useMemo(() => {
    const scored = candidates.filter((c) => c.status === "scored");
    return {
      total: candidates.length,
      suggested: scored.filter((c) => c.recommendation === "interview").length,
      undecided: scored.filter((c) => c.decision === "pending").length,
      ready: candidates.filter((c) => sendable(c) && c.email).length,
      readyAll: candidates.filter(sendable).length,
      sent: candidates.filter((c) => c.email_status === "sent").length,
      acceptable: scored.filter((c) => c.decision === "pending" && c.email_status === "draft" && (c.recommendation === "interview" || c.recommendation === "reject")),
      attention: candidates.filter(needsAttention).length,
    };
  }, [candidates]);

  const selected = candidates.find((c) => c.id === selectedId) || null;
  const selIndex = selected ? visible.findIndex((c) => c.id === selected.id) : -1;
  const goto = useCallback((delta: number) => {
    const i = visible.findIndex((c) => c.id === selectedId);
    const t = visible[i + delta];
    if (t) setSelectedId(t.id);
  }, [visible, selectedId]);

  // ↑/↓ moves between candidates, Esc closes; ignored while typing or while a dialog is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selectedId || modal) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Escape") setSelectedId(null);
      else if (e.key === "ArrowDown") { e.preventDefault(); goto(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); goto(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, modal, goto]);

  // ---- actions --------------------------------------------------------------------------------
  const replace = (row: Candidate) => setCandidates((cs) => cs.map((c) => (c.id === row.id ? row : c)));

  async function patch(id: string, body: Partial<Candidate>): Promise<boolean> {
    try { replace(await api<Candidate>(`/api/candidates/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })); return true; }
    catch (e) { flash(e instanceof Error ? e.message : "Update failed"); load(); return false; }
  }

  async function sendOne(id: string): Promise<{ ok: boolean; msg: string }> {
    try {
      const row = await post<Candidate & { deliveredTo?: string }>(`/api/candidates/${id}/send`);
      const { deliveredTo, ...c } = row;
      replace(c);
      return { ok: true, msg: deliveredTo ?? "" };
    } catch (e) {
      load();
      return { ok: false, msg: e instanceof Error ? e.message : "Send failed" };
    }
  }

  async function retry(id: string) {
    try { replace(await post<Candidate>(`/api/candidates/${id}/retry`)); flash("Scored"); }
    catch (e) { flash(e instanceof Error ? e.message : "Retry failed"); load(); }
  }

  async function acceptSuggestions() {
    setModal(null);
    try {
      const r = await post<{ invited: number; rejected: number }>("/api/candidates/decide-suggested");
      flash(`Marked ${r.invited} to invite and ${r.rejected} to reject. Nothing has been emailed yet.`);
      load();
    } catch (e) { flash(e instanceof Error ? e.message : "Failed"); }
  }

  async function remove(id: string) {
    setModal(null);
    try { await api(`/api/candidates/${id}`, { method: "DELETE" }); setSelectedId(null); flash("Removed"); } catch (e) { flash(e instanceof Error ? e.message : "Failed"); }
    load();
  }

  async function sendReview() {
    try { const r = await post<{ to: string }>("/api/review"); flash(`Review summary emailed to ${r.to}`); }
    catch (e) { flash(e instanceof Error ? e.message : "Failed"); }
  }

  async function signOut() { await post("/api/logout"); window.location.href = "/login"; }

  const sendIds = modal?.kind === "send" ? modal.ids : [];
  const step = candidates.length === 0 ? 1 : stats.undecided > 0 ? 2 : stats.ready > 0 ? 4 : stats.sent > 0 ? 4 : 3;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="logo">K</span> Kargo Hiring <span className="muted">· Founder&apos;s dashboard</span></div>
        <div className="stats">
          <Stat n={stats.total} label="applicants" />
          <Stat n={stats.suggested} label="suggested to interview" />
          <Stat n={stats.undecided} label="awaiting your call" tone={stats.undecided ? "warn" : undefined} />
          <Stat n={stats.sent} label="emails sent" />
        </div>
        <div className="top-actions">
          {!config.emailConfigured ? <span className="pill bad" title="RESEND_API_KEY is not set">Email not set up</span>
            : config.testRedirect ? <span className="pill warn" title="All emails are redirected to this address">Test mode → {config.testRedirect}</span>
            : <span className="pill live" title="Emails go to real candidates">Live email</span>}
          {config.reviewAvailable && <button className="btn" onClick={sendReview} title="Email yourself the top candidates and a link here">Email me a summary</button>}
          {config.openAccess ? <span className="pill warn" title="No APP_PASSWORD set. Local development only.">Open access (dev)</span> : <button className="link" onClick={signOut}>Sign out</button>}
        </div>
      </header>

      <ol className="steps" aria-label="Workflow">
        {["Add CVs", "Review the ranking", "Invite or reject", "Send emails"].map((s, i) => (
          <li key={s} className={i + 1 < step ? "done" : i + 1 === step ? "now" : ""}><span>{i + 1}</span>{s}</li>
        ))}
      </ol>

      {!config.geminiConfigured && <p className="callout bad">GEMINI_API_KEY isn&apos;t set on the server, so uploaded CVs can&apos;t be scored.</p>}

      <UploadCard uploadRole={uploadRole} setUploadRole={setUploadRole} queue={queue} onFiles={processFiles} onClear={() => setQueue([])}
        disabledReason={config.geminiConfigured ? null : "Add GEMINI_API_KEY to enable uploads"} />

      <section className="card">
        <div className="list-head">
          <div className="tabs" role="tablist">
            {(["PM", "SPM"] as Role[]).map((r) => (
              <button key={r} role="tab" aria-selected={tab === r} className={tab === r ? "on" : ""} onClick={() => { setTab(r); setSelectedId(null); }}>
                {roleName(r)} <span className="count">{candidates.filter((c) => c.applied_role === r).length}</span>
              </button>
            ))}
          </div>
          <input className="search" type="search" placeholder="Search name or summary" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search candidates" />
        </div>

        <div className="bulk">
          <div className="chips" role="group" aria-label="Filter">
            {([["all", "All"], ["pending", "Awaiting your call"], ["invite", "Invite"], ["reject", "Reject"], ["attention", "Needs attention"]] as const)
              .filter(([k]) => k !== "attention" || filterCounts.attention > 0)
              .map(([k, label]) => (
                <button key={k} className={`fchip ${filter === k ? "on" : ""}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>{label} <span>{filterCounts[k]}</span></button>
              ))}
          </div>
          <div className="list-actions">
            <button className="btn" disabled={!stats.acceptable.length} onClick={() => setModal({ kind: "accept" })} title="Set Invite/Reject wherever the AI is clear. 'Maybe' stays your call. Sends nothing.">
              Accept AI suggestions{stats.acceptable.length ? ` (${stats.acceptable.length})` : ""}
            </button>
            <button className="btn primary" disabled={!stats.readyAll} onClick={() => setModal({ kind: "send", ids: candidates.filter(sendable).map((c) => c.id) })}>
              Send {stats.readyAll || ""} decided email{stats.readyAll === 1 ? "" : "s"}
            </button>
          </div>
        </div>

        {loading ? <p className="muted pad">Loading…</p>
          : loadError ? <p className="callout bad">Couldn&apos;t load candidates: {loadError} <button className="link" onClick={load}>Try again</button></p>
          : visible.length === 0 ? (
            <p className="muted pad empty">{candidates.length === 0 ? "No applicants yet. Drop CVs in the box above to get a ranked shortlist." : roleRows.length === 0 ? `No ${roleName(tab)} applicants yet.` : "No candidates match this filter."}</p>
          ) : (
            <CandidateTable rows={visible} tab={tab} ranks={ranks} selectedId={selectedId} onSelect={setSelectedId}
              onDecide={(id, d: Decision) => patch(id, { decision: d })} />
          )}
        {stats.attention > 0 && filter !== "attention" && <p className="muted small">{stats.attention} candidate{stats.attention === 1 ? "" : "s"} failed or timed out. Open them to retry.</p>}
      </section>

      {selected && (
        <Drawer key={selected.id} c={selected} config={config}
          position={selIndex >= 0 ? { index: selIndex + 1, total: visible.length } : null}
          onPrev={selIndex > 0 ? () => goto(-1) : null} onNext={selIndex >= 0 && selIndex < visible.length - 1 ? () => goto(1) : null}
          onClose={() => setSelectedId(null)} onPatch={(b) => patch(selected.id, b)} onSend={() => setModal({ kind: "send", ids: [selected.id] })}
          onRetry={() => retry(selected.id)} onRemove={() => setModal({ kind: "remove", id: selected.id })} />
      )}

      {modal?.kind === "send" && (
        <SendModal candidates={candidates.filter((c) => sendIds.includes(c.id))} config={config} onSend={sendOne} onClose={() => { setModal(null); load(); }} />
      )}
      {modal?.kind === "accept" && (
        <Modal title="Accept the AI's suggestions?" onClose={() => setModal(null)}>
          <p>This marks <b>{stats.acceptable.filter((c) => c.recommendation === "interview").length} to invite</b> and <b>{stats.acceptable.filter((c) => c.recommendation === "reject").length} to reject</b> across both roles, wherever you haven&apos;t decided yet. Candidates the AI rated &ldquo;maybe&rdquo; stay for you.</p>
          <p className="callout live small">Nothing is emailed. You can still change any decision, and you confirm the send separately.</p>
          <div className="modal-actions"><button className="btn" onClick={() => setModal(null)} data-autofocus>Cancel</button><button className="btn primary" onClick={acceptSuggestions}>Mark them</button></div>
        </Modal>
      )}
      {modal?.kind === "remove" && (
        <Modal title="Remove this candidate?" onClose={() => setModal(null)}>
          <p>Their CV text, scores, brief and email drafts are deleted from the database. This can&apos;t be undone.</p>
          <div className="modal-actions"><button className="btn" onClick={() => setModal(null)} data-autofocus>Cancel</button><button className="btn danger" onClick={() => remove(modal.id)}>Remove</button></div>
        </Modal>
      )}
      {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
      <p className="foot muted small">Scores come from the rubric and your past hires. The AI suggests; you decide.</p>
    </div>
  );
}
