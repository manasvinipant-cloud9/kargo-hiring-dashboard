"use client";
import { useEffect, useRef, useState } from "react";
import { RUBRICS, type Role, type CriterionScore } from "@/lib/rubric";
import { roleName, fillVars } from "@/lib/fill";
import { EMAIL_RE } from "@/lib/candidates";
import type { AppConfig, Candidate } from "@/lib/types";
import { Avatar, Ring, ViewPill } from "./ui";
import { IconClose, IconDown, IconInfo, IconRetry, IconSend, IconTrash, IconUp } from "./icons";

const scoreFor = (c: Candidate, r: Role) => (r === "PM" ? c.pm_score : c.spm_score) ?? 0;

function Criteria({ role, scores }: { role: Role; scores: CriterionScore[] | null }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {RUBRICS[role].map((cr) => {
        const s = scores?.find((x) => x.key === cr.key);
        const n = s?.score ?? 0;
        return (
          <div key={cr.key} className="g-crit">
            <div className="g-crit-head">
              <span>{cr.label}<span className={`g-tag ${cr.inJD === "no" ? "is-insight" : cr.inJD === "partial" ? "is-part" : ""}`}>{cr.inJD === "no" ? "hidden signal" : cr.inJD === "partial" ? "partly in spec" : "in spec"}</span></span>
              <span>{n}/5 · {cr.weight}%</span>
            </div>
            <div className="g-segbar" aria-hidden>{[1, 2, 3, 4, 5].map((p) => <i key={p} className={p <= n ? "is-on" : ""} />)}</div>
            <p className="g-evidence">{s?.evidence || "No evidence in CV."}</p>
          </div>
        );
      })}
    </div>
  );
}

export default function DetailPane({ c, config, position, onPrev, onNext, onClose, onPatch, onSend, onRetry, onRemove }: {
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
  const top = useRef<HTMLDivElement>(null);

  const type = c.decision === "invite" ? "invite" : "rejection";
  const srvSubject = fillVars(c[`${type}_subject`], c);
  const srvBody = fillVars(c[`${type}_body`], c);

  useEffect(() => { setView(c.applied_role); top.current?.closest(".g-pane")?.scrollTo({ top: 0 }); }, [c.id, c.applied_role]);
  useEffect(() => { setName(c.full_name ?? ""); setEmail(c.email ?? ""); setEmailErr(null); }, [c.id, c.full_name, c.email]);

  // Keep the editor in step with the saved copy, but never overwrite what is being typed
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
  const label = c.full_name || c.file_name;

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
    <div className="g-detail" ref={top}>
      <div className="g-detail-bar">
        <div className="g-pager">
          <button className="g-icon" disabled={!onPrev} onClick={() => onPrev?.()} aria-label="Previous candidate" title="Previous (↑)"><IconUp /></button>
          <button className="g-icon" disabled={!onNext} onClick={() => onNext?.()} aria-label="Next candidate" title="Next (↓)"><IconDown /></button>
          {position && <span>{position.index} of {position.total}</span>}
        </div>
        <button className="g-icon" onClick={onClose} aria-label="Close" title="Close (Esc)"><IconClose /></button>
      </div>

      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <Avatar name={label} />
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em" }}>{label}</h2>
          <p className="g-meta-line">{roleName(c.applied_role)} · {c.years_pm_experience ?? "?"} yrs PM{c.phone ? ` · ${c.phone}` : ""} · {c.file_name}</p>
        </div>
      </div>

      <div className="g-identity">
        <label className="g-field">Name <small>used in the greeting</small>
          <input value={name} placeholder="Name not found on CV" onChange={(e) => setName(e.target.value)} onBlur={saveName} disabled={sent} maxLength={120} />
        </label>
        <label className="g-field">Email
          <input value={email} placeholder="No email found on CV" onChange={(e) => { setEmail(e.target.value); setEmailErr(null); }} onBlur={saveEmail} disabled={sent} inputMode="email" aria-invalid={!!emailErr} />
          {emailErr && <span className="g-bad-text">{emailErr}</span>}
        </label>
      </div>

      {c.status === "error" || c.stalled ? (
        <div className="g-note is-bad" style={{ display: "grid" }}>
          <p><b>{c.stalled ? "This took too long." : "Scoring didn't work."}</b> {c.error || "The request was cut off before it finished."}</p>
          <div className="g-actions" style={{ marginTop: 10 }}>
            <button className="g-btn is-main" disabled={busy} onClick={async () => { setBusy(true); await onRetry(); setBusy(false); }}><IconRetry />{busy ? "Retrying…" : "Try scoring again"}</button>
            <span className="g-hint">Uses the saved text, no re-upload needed. If it keeps failing, remove it and upload the file again.</span>
          </div>
        </div>
      ) : !scored ? <p className="g-sub">Reading this CV… usually about 20 seconds.</p> : (
        <>
          <div className="g-trio">
            {(["PM", "SPM"] as Role[]).map((r) => (
              <button key={r} className={`g-gauge ${view === r ? "is-on" : ""}`} onClick={() => setView(r)} aria-pressed={view === r}>
                <Ring value={scoreFor(c, r)} size={52} label={`${r} fit`} />
                <small>{r} fit{r === c.applied_role ? <><br />applied</> : null}</small>
              </button>
            ))}
            <div className="g-gauge" title="65+ strong · 45–64 borderline · under 45 weak. A suggestion only.">
              <div><small>Model&apos;s view</small><div style={{ marginTop: 6 }}><ViewPill r={c.recommendation} /></div></div>
            </div>
          </div>

          {c.interview_brief && (
            <section className="g-section">
              <h3>Brief for the conversation</h3>
              <p><b>Why they&apos;re here.</b> {c.interview_brief.why_ranked_here}</p>
              <div className="g-twocol">
                <div><h4>Strengths</h4><ul>{c.interview_brief.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
                <div><h4>Worth probing</h4><ul>{c.interview_brief.concerns.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
              </div>
              <div><h4>Questions to ask</h4><ol>{c.interview_brief.probe_questions.map((s, i) => <li key={i}>{s}</li>)}</ol></div>
            </section>
          )}

          <section className="g-section">
            <h3>{view} scorecard</h3>
            <p className="g-hint">A <span className="g-tag is-insight">hidden signal</span> is a pattern your best past hires share that the job spec never mentioned.</p>
            <Criteria role={view} scores={view === "PM" ? c.pm_breakdown : c.spm_breakdown} />
          </section>

          <section className="g-section">
            <h3>Decision</h3>
            {sent ? (
              <p className="g-note is-ok"><IconInfo /><span>{c.sent_email_type === "invite" ? "Invite" : "Rejection"} sent on {new Date(c.email_sent_at!).toLocaleString()}{config.testRedirect ? ` (test mode was on: it went to ${config.testRedirect}, not to ${c.email ?? "the candidate"})` : c.email ? ` to ${c.email}` : ""}. This record is now locked.</span></p>
            ) : (
              <>
                <div className="g-decide">
                  <button className={`g-btn ${c.decision === "invite" ? "is-main" : ""}`} onClick={() => onPatch({ decision: "invite" })} aria-pressed={c.decision === "invite"}>Invite them</button>
                  <button className={`g-btn ${c.decision === "reject" ? "is-danger" : ""}`} onClick={() => onPatch({ decision: "reject" })} aria-pressed={c.decision === "reject"}>Reject</button>
                  {c.decision !== "pending" && <button className="g-text" onClick={() => onPatch({ decision: "pending" })}>Undo</button>}
                  {c.decision === "pending" && <span className="g-hint">Model&apos;s view: <b>{c.recommendation === "interview" ? "strong fit" : c.recommendation === "maybe" ? "borderline" : "weak fit"}</b></span>}
                </div>
                {c.decision !== "pending" && (
                  <div className="g-composer">
                    <p className="g-hint">{c.decision === "invite" ? "Interview invite" : "Rejection"} draft. Edit freely; the greeting reads <code>Hi {name.trim().split(/\s+/)[0] || "there"},</code></p>
                    <label className="g-field">Subject<input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} /></label>
                    <label className="g-field">Message<textarea rows={11} value={body} onChange={(e) => setBody(e.target.value)} /></label>
                    {c.email_status === "failed" && <p className="g-note is-bad is-sm"><IconInfo />Last attempt failed: {c.email_error}</p>}
                    {config.testRedirect && <p className="g-note is-warn is-sm"><IconInfo />Test mode: this goes to <b>{config.testRedirect}</b>, not the candidate.</p>}
                    <div className="g-actions">
                      <button className="g-btn is-main" disabled={busy || !email.trim() || !config.emailConfigured} onClick={prepareSend}><IconSend />{busy ? "Saving…" : "Review & send"}</button>
                      {dirty && <button className="g-btn" disabled={busy} onClick={async () => { setBusy(true); await saveDraft(); setBusy(false); }}>Save edits</button>}
                      {!email.trim() && <span className="g-bad-text g-hint">Add an email address to send.</span>}
                      {!config.emailConfigured && <span className="g-bad-text g-hint">Sending is off on this server.</span>}
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}
      <button className="g-text is-bad g-danger-zone" onClick={onRemove}><IconTrash /> Remove this person and their data</button>
    </div>
  );
}
