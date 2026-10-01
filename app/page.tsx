"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Role } from "@/lib/rubric";
import { roleName } from "@/lib/fill";
import type { AppConfig, Candidate, Decision } from "@/lib/types";
import UploadPanel, { type QueueItem } from "./components/UploadPanel";
import CandidateList from "./components/CandidateList";
import DetailPane from "./components/DetailPane";
import SendDialog from "./components/SendDialog";
import ThemeSwitch from "./components/ThemeSwitch";
import { Modal, Tile } from "./components/ui";
import { IconBolt, IconInfo, IconSearch, IconSend, IconSpark } from "./components/icons";

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
  const [rawConfig, setConfig] = useState<AppConfig>({ emailConfigured: true, testRedirect: null, reviewAvailable: false, openAccess: false, sendBlocked: false, geminiConfigured: true, databaseConfigured: true });
  const config: AppConfig = { ...rawConfig, emailConfigured: rawConfig.emailConfigured && !rawConfig.sendBlocked };
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
  const countFor = (r: Role) => candidates.filter((c) => c.applied_role === r).length;
  const FILTERS = [["all", "Everyone"], ["pending", "To decide"], ["invite", "Invite"], ["reject", "Reject"], ["attention", "Needs attention"]] as const;

  return (
    <div className="g-shell">
      <header className="g-dock g-glass">
        <div className="g-brand"><span className="g-orb" aria-hidden /><div><h1>Kargo</h1><small>Hiring Studio</small></div></div>
        <div className="g-dock-end">
          <ThemeSwitch />
          {rawConfig.sendBlocked ? <span className="g-pill is-warn" title="Anyone with the link can open this demo, so it can't email real candidates. Set EMAIL_OVERRIDE_TO to turn on test-mode sending.">Demo · sending off</span>
            : !config.emailConfigured ? <span className="g-pill is-bad" title="RESEND_API_KEY is not set">Email off</span>
            : config.testRedirect ? <span className="g-pill is-warn" title="All emails are redirected to this address">Test mode → {config.testRedirect}</span>
            : <span className="g-pill is-ok" title="Emails go to real candidates">Live email</span>}
          {config.reviewAvailable && <button className="g-btn is-sm" onClick={sendReview} title="Email yourself the top candidates and a link here">Email me a recap</button>}
          {config.openAccess ? <span className="g-pill is-quiet" title="No login: anyone with the link can use this.">Open demo</span> : <button className="g-text" onClick={signOut}>Sign out</button>}
        </div>
      </header>

      <div className="g-tiles">
        <Tile n={stats.total} label="CVs in" />
        <Tile n={stats.suggested} label="strong fits" />
        <Tile n={stats.undecided} label="waiting on you" hot={stats.undecided > 0} />
        <Tile n={stats.sent} label="emails delivered" />
      </div>

      <ol className="g-flow g-glass" aria-label="Workflow">
        {["Drop CVs", "Read the ranking", "Decide", "Send"].map((s, i) => (
          <li key={s} className={i + 1 < step ? "is-done" : i + 1 === step ? "is-now" : ""}><span>{i + 1}</span>{s}</li>
        ))}
      </ol>

      {config.openAccess && <p className="g-note is-warn is-sm"><IconInfo /><span><b>Open demo.</b> There is no login, so everyone with this link sees the same candidates. Please upload only sample or test CVs, and use <b>Remove</b> when you&apos;re done.{rawConfig.sendBlocked ? " Emails to candidates are switched off." : ""}</span></p>}
      {!config.databaseConfigured && <p className="g-note is-bad"><IconInfo /><span><b>Database not connected.</b> Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to the server&apos;s environment variables (see .env.example), then redeploy.</span></p>}
      {!config.geminiConfigured && <p className="g-note is-bad"><IconInfo />GEMINI_API_KEY isn&apos;t set on the server, so uploaded CVs can&apos;t be scored.</p>}

      <div className="g-grid">
        <div className="g-col">
          <UploadPanel uploadRole={uploadRole} setUploadRole={setUploadRole} queue={queue} onFiles={processFiles} onClear={() => setQueue([])}
            disabledReason={!config.databaseConfigured ? "Connect the database to enable uploads" : config.geminiConfigured ? null : "Add GEMINI_API_KEY to enable uploads"} />

          <section className="g-panel g-glass">
            <header>
              <div className="g-seg" role="tablist">
                {(["PM", "SPM"] as Role[]).map((r) => (
                  <button key={r} role="tab" aria-selected={tab === r} className={tab === r ? "is-on" : ""} onClick={() => { setTab(r); setSelectedId(null); }}>
                    {r === "PM" ? "Product Manager" : "Senior PM"}<em>{countFor(r)}</em>
                  </button>
                ))}
              </div>
              <label className="g-search"><IconSearch /><input type="search" placeholder="Search people" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search candidates" /></label>
            </header>

            <div className="g-toolbar">
              <div className="g-filters" role="group" aria-label="Filter">
                {FILTERS.filter(([k]) => k !== "attention" || filterCounts.attention > 0).map(([k, label]) => (
                  <button key={k} className={`g-filter ${filter === k ? "is-on" : ""}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}<em>{filterCounts[k]}</em></button>
                ))}
              </div>
            </div>
            <div className="g-bulk">
              <button className="g-btn" disabled={!stats.acceptable.length} onClick={() => setModal({ kind: "accept" })} title="Set Invite or Reject wherever the model is clear. Borderline cases stay with you. Sends nothing.">
                <IconBolt />Take the model&apos;s picks{stats.acceptable.length ? ` (${stats.acceptable.length})` : ""}
              </button>
              <button className="g-btn is-main" disabled={!stats.readyAll} onClick={() => setModal({ kind: "send", ids: candidates.filter(sendable).map((c) => c.id) })}>
                <IconSend />Send {stats.readyAll || ""} decision{stats.readyAll === 1 ? "" : "s"}
              </button>
            </div>

            {loading ? <p className="g-empty">Loading…</p>
              : loadError && config.databaseConfigured ? <p className="g-note is-bad">Couldn&apos;t load candidates: {loadError} <button className="g-text" onClick={load}>Try again</button></p>
              : loadError ? <p className="g-empty">Nothing to show until the database is connected.</p>
              : visible.length === 0 ? (
                <p className="g-empty">{candidates.length === 0 ? "Nobody here yet. Drop some CVs above and a ranked shortlist appears." : roleRows.length === 0 ? `No ${roleName(tab)} applicants yet.` : "No one matches this filter."}</p>
              ) : (
                <CandidateList rows={visible} tab={tab} ranks={ranks} selectedId={selectedId} onSelect={setSelectedId} onDecide={(id, d: Decision) => patch(id, { decision: d })} />
              )}
            {stats.attention > 0 && filter !== "attention" && <p className="g-hint" style={{ marginTop: 10 }}>{stats.attention} CV{stats.attention === 1 ? "" : "s"} failed or timed out. Open them to retry.</p>}
          </section>
        </div>

        {selected && <button className="g-scrim" aria-label="Close details" onClick={() => setSelectedId(null)} />}
        <aside className={`g-pane g-glass ${selected ? "is-open" : ""}`} aria-label="Candidate details">
          {selected ? (
            <DetailPane key={selected.id} c={selected} config={config}
              position={selIndex >= 0 ? { index: selIndex + 1, total: visible.length } : null}
              onPrev={selIndex > 0 ? () => goto(-1) : null} onNext={selIndex >= 0 && selIndex < visible.length - 1 ? () => goto(1) : null}
              onClose={() => setSelectedId(null)} onPatch={(b) => patch(selected.id, b)} onSend={() => setModal({ kind: "send", ids: [selected.id] })}
              onRetry={() => retry(selected.id)} onRemove={() => setModal({ kind: "remove", id: selected.id })} />
          ) : (
            <div className="g-pane-empty"><IconSpark /><b>Pick someone to open their scorecard</b><span>You&apos;ll see why they ranked here, what to ask them, and the email that would go out. Use ↑ ↓ to move between people.</span></div>
          )}
        </aside>
      </div>

      {modal?.kind === "send" && (
        <SendDialog candidates={candidates.filter((c) => sendIds.includes(c.id))} config={config} onSend={sendOne} onClose={() => { setModal(null); load(); }} />
      )}
      {modal?.kind === "accept" && (
        <Modal title="Take the model's picks?" onClose={() => setModal(null)}>
          <p>This marks <b>{stats.acceptable.filter((c) => c.recommendation === "interview").length} to invite</b> and <b>{stats.acceptable.filter((c) => c.recommendation === "reject").length} to reject</b> across both roles, wherever you haven&apos;t decided yet. Borderline candidates stay with you.</p>
          <p className="g-note is-ok is-sm"><IconInfo />Nothing is emailed. You can change any decision, and you confirm the send separately.</p>
          <div className="g-dialog-actions"><button className="g-btn" onClick={() => setModal(null)} data-autofocus>Cancel</button><button className="g-btn is-main" onClick={acceptSuggestions}>Mark them</button></div>
        </Modal>
      )}
      {modal?.kind === "remove" && (
        <Modal title="Remove this person?" onClose={() => setModal(null)}>
          <p>Their CV text, scores, brief and email drafts are deleted from the database. This can&apos;t be undone.</p>
          <div className="g-dialog-actions"><button className="g-btn" onClick={() => setModal(null)} data-autofocus>Cancel</button><button className="g-btn is-danger" onClick={() => remove(modal.id)}>Remove</button></div>
        </Modal>
      )}
      {toast && <div className="g-toast g-glass" role="status" aria-live="polite">{toast}</div>}
    </div>
  );
}
