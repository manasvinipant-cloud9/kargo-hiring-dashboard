"use client";
import { useState } from "react";
import type { AppConfig, Candidate } from "@/lib/types";
import { fillVars } from "@/lib/fill";
import { Modal } from "./ui";

type Result = { id: string; ok: boolean; msg: string };

/** Confirms exactly who will be emailed and what, then sends one by one with live progress. */
export default function SendModal({ candidates, config, onSend, onClose }: {
  candidates: Candidate[]; config: AppConfig;
  onSend: (id: string) => Promise<{ ok: boolean; msg: string }>; onClose: () => void;
}) {
  const sendable = candidates.filter((c) => c.email);
  const skipped = candidates.filter((c) => !c.email);
  const [phase, setPhase] = useState<"confirm" | "sending" | "done">("confirm");
  const [results, setResults] = useState<Result[]>([]);
  const invites = sendable.filter((c) => c.decision === "invite").length;
  const rejects = sendable.length - invites;
  const single = sendable.length === 1 ? sendable[0] : null;

  async function run() {
    setPhase("sending");
    for (const c of sendable) {
      const r = await onSend(c.id);
      setResults((x) => [...x, { id: c.id, ...r }]);
      await new Promise((res) => setTimeout(res, 350)); // stays under Resend's 2 requests/second
    }
    setPhase("done");
  }
  const resultFor = (id: string) => results.find((r) => r.id === id);
  const okCount = results.filter((r) => r.ok).length;

  return (
    <Modal title={phase === "done" ? `${okCount} of ${sendable.length} sent` : single ? `Send ${single.decision === "invite" ? "invite" : "rejection"} to ${single.full_name || "this candidate"}?` : `Send ${sendable.length} emails?`} onClose={onClose} locked={phase === "sending"} wide>
      {phase === "confirm" && (
        <>
          {!config.emailConfigured ? (
            <p className="callout bad">Email isn&apos;t set up on this server (no RESEND_API_KEY), so nothing can be sent.</p>
          ) : config.testRedirect ? (
            <p className="callout warn"><b>Test mode.</b> Every email below is delivered to <b>{config.testRedirect}</b> instead of the candidate.</p>
          ) : (
            <p className="callout live"><b>This sends real email to {single ? "the candidate" : "candidates"}</b> and can&apos;t be undone.</p>
          )}
          {!single && <p className="muted small">{invites} interview invite{invites === 1 ? "" : "s"} · {rejects} rejection{rejects === 1 ? "" : "s"}. Each email can be edited in the candidate panel first.</p>}
        </>
      )}
      <ul className="recipients">
        {sendable.map((c) => {
          const r = resultFor(c.id);
          const type = c.decision === "invite" ? "invite" : "rejection";
          return (
            <li key={c.id}>
              <div className="who"><b>{c.full_name || c.file_name}</b><span className="muted small">{c.email}</span></div>
              <span className={`chip ${c.decision}`}>{c.decision === "invite" ? "Invite" : "Reject"}</span>
              <span className={`result ${r ? (r.ok ? "ok" : "error") : "muted"}`}>{r ? (r.ok ? "✓ Sent" : r.msg) : phase === "sending" ? "waiting…" : ""}</span>
              {single && phase === "confirm" && (
                <div className="preview"><b>{fillVars(c[`${type}_subject`], c)}</b><pre>{fillVars(c[`${type}_body`], c)}</pre></div>
              )}
            </li>
          );
        })}
      </ul>
      {skipped.length > 0 && <p className="callout warn">{skipped.length} decided candidate{skipped.length === 1 ? " has" : "s have"} no email address and will be skipped: {skipped.map((c) => c.full_name || c.file_name).join(", ")}.</p>}
      <div className="modal-actions">
        {phase === "confirm" && <>
          <button className="btn" onClick={onClose} data-autofocus>Cancel</button>
          <button className="btn primary" disabled={!config.emailConfigured || sendable.length === 0} onClick={run}>{single ? "Send now" : `Send ${sendable.length} email${sendable.length === 1 ? "" : "s"}`}</button>
        </>}
        {phase === "sending" && <span className="muted">Sending {results.length + 1} of {sendable.length}…</span>}
        {phase === "done" && <button className="btn primary" onClick={onClose} data-autofocus>Done</button>}
      </div>
    </Modal>
  );
}
