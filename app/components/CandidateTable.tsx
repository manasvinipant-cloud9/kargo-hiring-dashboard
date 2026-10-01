"use client";
import type { Role } from "@/lib/rubric";
import type { Candidate, Decision } from "@/lib/types";
import { ScoreBar, SuggestionChip } from "./ui";

const scoreFor = (c: Candidate, r: Role) => (r === "PM" ? c.pm_score : c.spm_score) ?? 0;

export default function CandidateTable({ rows, tab, ranks, selectedId, onSelect, onDecide }: {
  rows: Candidate[]; tab: Role; ranks: Map<string, number>; selectedId: string | null;
  onSelect: (id: string) => void; onDecide: (id: string, d: Decision) => void;
}) {
  const other: Role = tab === "PM" ? "SPM" : "PM";
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>#</th><th>Candidate</th><th>{tab} fit</th><th className="hide-sm">{other} fit</th><th className="hide-sm">AI suggests</th><th>Your call</th><th className="hide-sm">Email</th></tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const scored = c.status === "scored";
            const locked = c.email_status === "sent";
            const ownScore = scoreFor(c, tab), otherScore = scoreFor(c, other);
            return (
              <tr key={c.id} tabIndex={0} aria-selected={selectedId === c.id} className={selectedId === c.id ? "sel" : ""}
                onClick={() => onSelect(c.id)} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) onSelect(c.id); }}>
                <td className="rank">{ranks.get(c.id) ?? "–"}</td>
                <td>
                  <div className="name">{c.full_name || c.file_name}{!c.email && scored && <span className="flag" title="No email address found on this CV">no email</span>}</div>
                  <div className="muted small ellipsis">
                    {scored ? c.summary : c.status === "error" ? <span className="error">Failed: {c.error}</span> : c.stalled ? <span className="error">Timed out. Open to retry.</span> : "Scoring…"}
                  </div>
                </td>
                <td>{scored ? <ScoreBar v={ownScore} /> : c.status === "processing" && !c.stalled ? <span className="spinner" aria-label="Scoring" /> : <span className="chip failed">Needs attention</span>}</td>
                <td className="hide-sm">{scored && <span className={otherScore > ownScore + 5 ? "alt strong" : "alt"} title={otherScore > ownScore + 5 ? `Fits ${other} better` : undefined}>{otherScore}{otherScore > ownScore + 5 && ` ↑ ${other}`}</span>}</td>
                <td className="hide-sm"><SuggestionChip r={c.recommendation} /></td>
                <td onClick={(e) => e.stopPropagation()}>
                  {locked ? <span className={`chip ${c.decision}`}>{c.decision === "invite" ? "Invited" : "Rejected"}</span> : scored ? (
                    <div className="quick" role="group" aria-label={`Decision for ${c.full_name || c.file_name}`}>
                      <button className={`q inv ${c.decision === "invite" ? "on" : ""}`} aria-pressed={c.decision === "invite"} title="Invite to interview" onClick={() => onDecide(c.id, c.decision === "invite" ? "pending" : "invite")}>Invite</button>
                      <button className={`q rej ${c.decision === "reject" ? "on" : ""}`} aria-pressed={c.decision === "reject"} title="Reject" onClick={() => onDecide(c.id, c.decision === "reject" ? "pending" : "reject")}>Reject</button>
                    </div>
                  ) : <span className="muted small">–</span>}
                </td>
                <td className="hide-sm">{locked ? <span className="chip sent">Sent</span> : c.email_status === "failed" ? <span className="chip failed" title={c.email_error ?? ""}>Failed</span> : <span className="muted small">{c.decision === "pending" ? "–" : "Ready"}</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
