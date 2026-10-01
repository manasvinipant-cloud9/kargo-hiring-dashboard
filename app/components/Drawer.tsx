"use client";
import { useEffect, useRef, useState } from "react";
import { RUBRICS, type Role, type CriterionScore } from "@/lib/rubric";
import { roleName, fillVars } from "@/lib/fill";
import { EMAIL_RE } from "@/lib/candidates";
import type { AppConfig, Candidate } from "@/lib/types";
import { SuggestionChip } from "./ui";

const scoreFor = (c: Candidate, r: Role) => (r === "PM" ? c.pm_score : c.spm_score) ?? 0;

function Breakdown({ role, scores }: { role: Role; scores: CriterionScore[] | null }) {
  return (
    <div className="breakdown">
      {RUBRICS[role].map((cr) => {
        const s = scores?.find((x) => x.key === cr.key);
        return (
          <div key={cr.key} className="crit">
            <div className="crit-head">
              <span>{cr.label} <span className={`jd ${cr.inJD}`}>{cr.inJD === "no" ? "not in JD" : cr.inJD === "partial" ? "partly in JD" : "in JD"}</span></span>
              <span className="muted small">{s?.score ?? 0}/5 · {cr.weight}%</span>
            </div>
            <div className="pips">{[1, 2, 3, 4, 5].map((p) => <i key={p} className={p <= (s?.score ?? 0) ? "on" : ""} />)}</div>
            <p className="small evidence">{s?.evidence || "No evidence in CV."}</p>
          </div>
        );
      })}
    </div>
  );
}

export default function Drawer({ c, config, position, onPrev, onNext, onClose, onPatch, onSend, onRetry, onRemove }: {
  c: Candidate; config: AppConfig; position: { index: number; total: number } | null;
  onPrev: (() => void) | null; onNext: (() => void) | null; onClose: () => void;
  onPatch: (b: Partial<Candidate>) => Promise<boolean>; onSend: () => void; onRetry: () => Promise<void>; onRemove: () => void;
}) {
  const [view, setView] = useState<Role>(c.applied_role);
  const [name, setName] = useState(c.full_name ?? "");
  const [email, setEmail] = useState(c.email ?? "");
  const [emailErr, setEmailErr] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLElement>(null);

  const type = c.decision === "invite" ? "invite" : "rejection";
  const srvSubject = fillVars(c[`${type}_subject`], c);
  const srvBody = fillVars(c[`${type}_body`], c);

  useEffect(() => { setView(c.applied_role); scroller.current?.scrollTo({ top: 0 }); }, [c.id, c.applied_role]);
  useEffect(() => { setName(c.full_name ?? ""); setEmail(c.email ?? ""); setEmailErr(null); }, [c.id, c.full_name, c.email]);

  // Keep the editor in step with the server copy, but never overwrite what Arjun is in the middle of typing
  // (background refreshes used to wipe half-written edits).
  const synced = useRef({ key: "", subject: "", body: "" });
  useEffect(() => {
    const key = `${c.id}:${type}`;
    if (synced.current.key !== key || (subject === synced.current.subject && body === synced.current.body)) { setSubject(srvSubject); setBody(srvBody); }
    synced.current = { key, subject: srvSubject, body: srvBody };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id, type, srvSubject, srvBody]);

  const sent = c.email_status === "sent";
  const dirty = subject !== srvSubject || body !== srvBody;
  const scored = c.status === "scored";

  async function saveName() { if (name.trim() !== (c.full_name ?? "")) await onPatch({ full_name: name.trim() || null }); }
  async function saveEmail(): Promise<boolean> {
    const e = email.trim();
    if (e === (c.email ?? "")) return true;
    if (e && !EMAIL_RE.test(e)) { setEmailErr("That doesn't look like a valid email address"); return false; }
    setEmailErr(null);
    return onPatch({ email: e || null });
  }
  async function saveDraft(): Promise<boolean> {
    if (!dirty) return true;
    return onPatch({ [`${type}_subject`]: subject, [`${type}_body`]: body } as Partial<Candidate>);
  }
  async function prepareSend() {
    setBusy(true);
    await saveName();
    const ready = (await saveEmail()) && (await saveDraft());
    setBusy(false);
    if (ready) onSend();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <aside ref={scroller} className="drawer" onClick={(e) => e.stopPropagation()} aria-label={`Candidate: ${c.full_name || c.file_name}`}>
        <div className="drawer-nav">
          <div className="pager">
            <button className="btn small" disabled={!onPrev} onClick={() => onPrev?.()} aria-label="Previous candidate" title="Previous (↑)">↑</button>
            <button className="btn small" disabled={!onNext} onClick={() => onNext?.()} aria-label="Next candidate" title="Next (↓)">↓</button>
            {position && <span className="muted small">{position.index} of {position.total} in view</span>}
          </div>
          <button className="icon" onClick={onClose} aria-label="Close" title="Close (Esc)">×</button>
        </div>

        <div className="identity">
          <label>Name <span className="hint">(used in the greeting)</span>
            <input value={name} placeholder="Name not found on CV" onChange={(e) => setName(e.target.value)} onBlur={saveName} disabled={sent} maxLength={120} />
          </label>
          <label>Email
            <input value={email} placeholder="No email found on CV" onChange={(e) => { setEmail(e.target.value); setEmailErr(null); }} onBlur={saveEmail} disabled={sent} inputMode="email" aria-invalid={!!emailErr} />
            {emailErr && <span className="error small">{emailErr}</span>}
          </label>
        </div>
        <p className="muted small meta">Applied: {roleName(c.applied_role)} · {c.years_pm_experience ?? "?"} yrs PM{c.phone ? ` · ${c.phone}` : ""} · {c.file_name}</p>

        {c.status === "error" || c.stalled ? (
          <div className="callout bad">
            <b>{c.stalled ? "Scoring timed out." : "Scoring failed."}</b> {c.error || "The request was cut off before it finished."}
            <div className="row-actions">
              <button className="btn primary" disabled={busy} onClick={async () => { setBusy(true); await onRetry(); setBusy(false); }}>{busy ? "Retrying…" : "Retry scoring"}</button>
              <span className="muted small">Uses the saved text, so no re-upload is needed. If this keeps failing, remove it and upload the file again.</span>
            </div>
          </div>
        ) : !scored ? <p className="muted">Scoring… this usually takes about 20 seconds.</p> : (
          <>
            <div className="scores-row">
              {(["PM", "SPM"] as Role[]).map((r) => (
                <button key={r} className={`score-card ${view === r ? "on" : ""}`} onClick={() => setView(r)} aria-pressed={view === r}>
                  <span className="muted small">{r} fit{r === c.applied_role ? " · applied" : ""}</span>
                  <b>{scoreFor(c, r)}</b>
                </button>
              ))}
              <div className="score-card static" title="65+ interview · 45–64 maybe · under 45 reject. A suggestion only.">
                <span className="muted small">AI suggests</span>
                <SuggestionChip r={c.recommendation} />
              </div>
            </div>

            {c.interview_brief && (
              <section className="block">
                <h3>Interview brief</h3>
                <p><b>Why ranked here.</b> {c.interview_brief.why_ranked_here}</p>
                <div className="two">
                  <div><h4>Strengths</h4><ul>{c.interview_brief.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
                  <div><h4>Concerns</h4><ul>{c.interview_brief.concerns.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
                </div>
                <h4>What to probe in the interview</h4>
                <ol>{c.interview_brief.probe_questions.map((s, i) => <li key={i}>{s}</li>)}</ol>
              </section>
            )}

            <section className="block">
              <h3>{view} rubric breakdown</h3>
              <p className="muted small">Green <span className="jd no">not in JD</span> marks a pattern found in your best past hires that the job spec never asked for.</p>
              <Breakdown role={view} scores={view === "PM" ? c.pm_breakdown : c.spm_breakdown} />
            </section>

            <section className="block decide">
              <h3>2 · Your call</h3>
              {sent ? (
                <p className="callout live">✓ {c.sent_email_type === "invite" ? "Invite" : "Rejection"} sent on {new Date(c.email_sent_at!).toLocaleString()}{config.testRedirect ? ` (test mode is on: it went to ${config.testRedirect}, not to ${c.email ?? "the candidate"})` : c.email ? ` to ${c.email}` : ""}. This record is now locked.</p>
              ) : (
                <>
                  <div className="decide-btns">
                    <button className={`btn ${c.decision === "invite" ? "primary" : ""}`} onClick={() => onPatch({ decision: "invite" })} aria-pressed={c.decision === "invite"}>Invite to interview</button>
                    <button className={`btn ${c.decision === "reject" ? "danger" : ""}`} onClick={() => onPatch({ decision: "reject" })} aria-pressed={c.decision === "reject"}>Reject</button>
                    {c.decision !== "pending" && <button className="link" onClick={() => onPatch({ decision: "pending" })}>Undo</button>}
                    {c.decision === "pending" && <span className="muted small">AI suggests: <b>{c.recommendation}</b></span>}
                  </div>
                  {c.decision !== "pending" && (
                    <div className="composer">
                      <p className="muted small" style={{ margin: 0 }}>
                        {c.decision === "invite" ? "Interview invite" : "Rejection"} draft. Edit anything; <code>Hi {name.trim().split(/\s+/)[0] || "there"},</code> is filled in for you.
                      </p>
                      <label>Subject<input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} /></label>
                      <label>Message<textarea rows={11} value={body} onChange={(e) => setBody(e.target.value)} /></label>
                      {c.email_status === "failed" && <p className="callout bad small">Last attempt failed: {c.email_error}</p>}
                      {config.testRedirect && <p className="callout warn small">Test mode: this will be delivered to <b>{config.testRedirect}</b>, not the candidate.</p>}
                      <div className="row-actions">
                        <button className="btn primary" disabled={busy || !email.trim() || !config.emailConfigured} onClick={prepareSend}>
                          {busy ? "Saving…" : `Review & send ${c.decision === "invite" ? "invite" : "rejection"}`}
                        </button>
                        {dirty && <button className="btn" disabled={busy} onClick={async () => { setBusy(true); await saveDraft(); setBusy(false); }}>Save edits</button>}
                        {!email.trim() && <span className="error small">Add an email address to send.</span>}
                        {!config.emailConfigured && <span className="error small">Email isn&apos;t set up on the server.</span>}
                      </div>
                    </div>
                  )}
                </>
              )}
            </section>
          </>
        )}
        <button className="link danger-link" onClick={onRemove}>Remove candidate and their data</button>
      </aside>
    </div>
  );
}
