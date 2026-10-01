"use client";
import { useState } from "react";
import type { AppConfig, Candidate } from "@/lib/types";
import { fillVars } from "@/lib/fill";
import { Modal } from "./ui";
import { IconInfo, IconSend } from "./icons";

type Result = { id: string; ok: boolean; msg: string };

/** Confirms exactly who will be emailed and what, then sends one by one with live progress. */
export default function SendDialog({ candidates, config, onSend, onClose }: {
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
  const okCount = results.filter((r) => r.ok).length;

  async function run() {
    setPhase("sending");
    for (const c of sendable) {
      const r = await onSend(c.id);
      setResults((x) => [...x, { id: c.id, ...r }]);
      await new Promise((res) => setTimeout(res, 350)); // stays under Resend's 2 requests/second
    }
    setPhase("done");
  }

  const title = phase === "done" ? `${okCount} of ${sendable.length} delivered`
    : single ? `Send the ${single.decision === "invite" ? "invite" : "rejection"} to ${single.full_name || "this candidate"}?` : `Send ${sendable.length} emails?`;

  return (
    <Modal title={title} onClose={onClose} locked={phase === "sending"} wide>
      {phase === "confirm" && (
        <>
          {!config.emailConfigured ? (
            <p className="g-note is-bad"><IconInfo />Email isn&apos;t switched on for this server, so nothing can be sent.</p>
          ) : config.testRedirect ? (
            <p className="g-note is-warn"><IconInfo /><span><b>Test mode.</b> Every email below goes to <b>{config.testRedirect}</b>, not to the candidate.</span></p>
          ) : (
            <p className="g-note is-ok"><IconInfo /><span><b>This emails real {single ? "person" : "people"}</b> and can&apos;t be taken back.</span></p>
          )}
          {!single && <p className="g-hint">{invites} invite{invites === 1 ? "" : "s"} and {rejects} rejection{rejects === 1 ? "" : "s"}. Edit any message first in the candidate pane.</p>}
        </>
      )}
      <ul className="g-people">
        {sendable.map((c) => {
          const r = results.find((x) => x.id === c.id);
          const type = c.decision === "invite" ? "invite" : "rejection";
          return (
            <li key={c.id}>
              <div className="who"><b>{c.full_name || c.file_name}</b><span>{c.email}</span></div>
              <span className={`g-pill dec-${c.decision}`}>{c.decision === "invite" ? "Invite" : "Reject"}</span>
              <span className={`res ${r ? (r.ok ? "is-ok" : "is-bad") : ""}`}>{r ? (r.ok ? "✓ Delivered" : r.msg) : phase === "sending" ? "waiting…" : ""}</span>
              {single && phase === "confirm" && <div className="peek"><b>{fillVars(c[`${type}_subject`], c)}</b><pre>{fillVars(c[`${type}_body`], c)}</pre></div>}
            </li>
          );
        })}
      </ul>
      {skipped.length > 0 && <p className="g-note is-warn"><IconInfo />{skipped.length} decided candidate{skipped.length === 1 ? " has" : "s have"} no email address and will be skipped: {skipped.map((c) => c.full_name || c.file_name).join(", ")}.</p>}
      <div className="g-dialog-actions">
        {phase === "confirm" && <>
          <button className="g-btn" onClick={onClose} data-autofocus>Cancel</button>
          <button className="g-btn is-main" disabled={!config.emailConfigured || sendable.length === 0} onClick={run}><IconSend />{single ? "Send now" : `Send ${sendable.length}`}</button>
        </>}
        {phase === "sending" && <span className="g-sub">Sending {results.length + 1} of {sendable.length}…</span>}
        {phase === "done" && <button className="g-btn is-main" onClick={onClose} data-autofocus>Done</button>}
      </div>
    </Modal>
  );
}
