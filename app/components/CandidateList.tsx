"use client";
import type { Role } from "@/lib/rubric";
import type { Candidate, Decision } from "@/lib/types";
import { Avatar, Ring, ViewPill } from "./ui";
import { IconCheck, IconClose } from "./icons";

const scoreFor = (c: Candidate, r: Role) => (r === "PM" ? c.pm_score : c.spm_score) ?? 0;

export default function CandidateList({ rows, tab, ranks, selectedId, onSelect, onDecide }: {
  rows: Candidate[]; tab: Role; ranks: Map<string, number>; selectedId: string | null;
  onSelect: (id: string) => void; onDecide: (id: string, d: Decision) => void;
}) {
  const other: Role = tab === "PM" ? "SPM" : "PM";
  return (
    <ul className="g-list">
      {rows.map((c) => {
        const scored = c.status === "scored";
        const locked = c.email_status === "sent";
        const own = scoreFor(c, tab), alt = scoreFor(c, other);
        const label = c.full_name || c.file_name;
        return (
          <li key={c.id} role="button" tabIndex={0} aria-pressed={selectedId === c.id} className={`g-row ${selectedId === c.id ? "is-open" : ""}`}
            onClick={() => onSelect(c.id)} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) onSelect(c.id); }}>
            <span className="g-rank">{ranks.get(c.id) ?? "·"}</span>
            <Avatar name={label} />
            <div className="g-who">
              <b>{label}{!c.email && scored && <span className="g-flag" title="No email address found on this CV">no email</span>}</b>
              <p className={`g-line ${!scored && (c.status === "error" || c.stalled) ? "is-bad" : ""}`}>
                {scored ? c.summary : c.status === "error" ? `Failed: ${c.error}` : c.stalled ? "Timed out. Open it to retry." : "Reading this CV…"}
              </p>
            </div>
            <div className="g-meta" onClick={(e) => e.stopPropagation()}>
              {scored ? (
                <>
                  <Ring value={own} label={`${tab} fit`} />
                  <span className={`g-also ${alt > own + 5 ? "is-better" : ""}`} title={alt > own + 5 ? `Fits ${other} better` : `${other} fit`}>{other}<br />{alt}{alt > own + 5 ? " ↑" : ""}</span>
                  <ViewPill r={c.recommendation} />
                </>
              ) : c.status === "processing" && !c.stalled ? <span className="g-spin" aria-label="Scoring" /> : <span className="g-pill is-bad">Needs attention</span>}
              {locked ? <span className={`g-pill dec-${c.decision}`}>{c.decision === "invite" ? "Invited" : "Rejected"}</span> : scored && (
                <span className="g-acts" role="group" aria-label={`Decision for ${label}`}>
                  <button className={`g-act is-accept ${c.decision === "invite" ? "is-on" : ""}`} aria-pressed={c.decision === "invite"} title="Invite them" aria-label="Invite" onClick={() => onDecide(c.id, c.decision === "invite" ? "pending" : "invite")}><IconCheck /></button>
                  <button className={`g-act is-decline ${c.decision === "reject" ? "is-on" : ""}`} aria-pressed={c.decision === "reject"} title="Reject" aria-label="Reject" onClick={() => onDecide(c.id, c.decision === "reject" ? "pending" : "reject")}><IconClose /></button>
                </span>
              )}
              {locked ? <span className="g-pill mail-sent">Sent</span> : c.email_status === "failed" ? <span className="g-pill mail-failed" title={c.email_error ?? ""}>Send failed</span> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
