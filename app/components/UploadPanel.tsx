"use client";
import { useRef, useState } from "react";
import type { Role } from "@/lib/rubric";
import { IconUpload } from "./icons";

export type QueueItem = { id: number; name: string; state: "waiting" | "working" | "done" | "dup" | "error"; msg?: string };

const CHOICES = [["PM", "Product Manager"], ["SPM", "Senior PM"], ["AUTO", "Not sure"]] as const;
const LABEL = { PM: "Product Manager", SPM: "Senior Product Manager", AUTO: "not sure (filed under the better fit)" } as const;

export default function UploadPanel({ uploadRole, setUploadRole, queue, onFiles, onClear, disabledReason }: {
  uploadRole: Role | "AUTO"; setUploadRole: (r: Role | "AUTO") => void; queue: QueueItem[];
  onFiles: (files: File[]) => void; onClear: () => void; disabledReason: string | null;
}) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pending = queue.filter((q) => q.state === "waiting" || q.state === "working").length;
  const failed = queue.filter((q) => q.state === "error").length;
  const finished = queue.length - pending;
  const take = (list: FileList | File[] | null) => { if (list && !disabledReason) onFiles(Array.from(list)); };

  return (
    <section className="g-panel g-glass"
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false); }}
      onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}>
      <header>
        <h2>Drop in CVs</h2>
        <div className="g-seg" role="radiogroup" aria-label="Role these CVs applied for">
          {CHOICES.map(([k, label]) => (
            <button key={k} role="radio" aria-checked={uploadRole === k} className={uploadRole === k ? "is-on" : ""} onClick={() => setUploadRole(k)}>{label}</button>
          ))}
        </div>
      </header>
      <p className="g-hint" style={{ marginBottom: 12 }}>Names, contact details, schools and gendered words are stripped before the model reads a thing. Every CV is scored for both roles.</p>
      <button type="button" className={`g-drop ${over ? "is-over" : ""}`} disabled={!!disabledReason} onClick={() => input.current?.click()}>
        <IconUpload />
        <b>{disabledReason ?? (over ? "Release to add" : "Drop CVs here or browse")}</b>
        <span>PDF, DOCX or TXT · up to 4 MB each · applying for {LABEL[uploadRole]}</span>
      </button>
      <input ref={input} type="file" multiple accept=".pdf,.docx,.txt" hidden onChange={(e) => { take(e.target.files); e.target.value = ""; }} />
      {queue.length > 0 && (
        <div className="g-queue">
          <div className="g-queue-head">
            <span>{pending ? `Reading… ${finished} of ${queue.length} done` : `${finished} processed${failed ? ` · ${failed} failed` : ""}`}</span>
            {!pending && <button className="g-text" onClick={onClear}>Clear</button>}
          </div>
          <div className="g-meter" aria-hidden><i style={{ width: `${(finished / queue.length) * 100}%` }} /></div>
          <ul>
            {queue.map((q) => (
              <li key={q.id} className={`is-${q.state}`}>{q.name}<em>{q.state === "working" ? "scoring…" : q.state === "waiting" ? "queued" : q.msg || ""}</em></li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
