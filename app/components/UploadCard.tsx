"use client";
import { useRef, useState } from "react";
import type { Role } from "@/lib/rubric";
import { roleName } from "@/lib/fill";

export type QueueItem = { id: number; name: string; state: "waiting" | "working" | "done" | "dup" | "error"; msg?: string };

export default function UploadCard({ uploadRole, setUploadRole, queue, onFiles, onClear, disabledReason }: {
  uploadRole: Role | "AUTO"; setUploadRole: (r: Role | "AUTO") => void; queue: QueueItem[];
  onFiles: (files: File[]) => void; onClear: () => void; disabledReason: string | null;
}) {
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pending = queue.filter((q) => q.state === "waiting" || q.state === "working").length;
  const failed = queue.filter((q) => q.state === "error").length;
  const finished = queue.length - pending;
  const take = (list: FileList | File[] | null) => { if (list && !disabledReason) onFiles(Array.from(list)); };

  return (
    <section className="card upload"
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); take(e.dataTransfer.files); }}>
      <div className="upload-row">
        <div>
          <h2>1 · Add CVs</h2>
          <p className="muted small">Name, email, phone, profile links, school names and gendered words are removed before the AI reads a CV. Each CV is scored against both roles.</p>
        </div>
        <div className="seg" role="radiogroup" aria-label="Role these CVs applied for">
          {(["PM", "SPM", "AUTO"] as const).map((r) => (
            <button key={r} role="radio" aria-checked={uploadRole === r} className={uploadRole === r ? "on" : ""} onClick={() => setUploadRole(r)}>
              {r === "AUTO" ? "Not sure" : roleName(r)}
            </button>
          ))}
        </div>
      </div>
      <button type="button" className={`dropzone ${dragging ? "over" : ""}`} disabled={!!disabledReason} onClick={() => input.current?.click()}>
        <b>{disabledReason ?? (dragging ? "Drop to upload" : "Drop CVs here, or click to choose files")}</b>
        <span>PDF, DOCX or TXT · up to 4 MB each · applied role: {uploadRole === "AUTO" ? "not sure (filed under the better fit)" : roleName(uploadRole)}</span>
      </button>
      <input ref={input} type="file" multiple accept=".pdf,.docx,.txt" hidden onChange={(e) => { take(e.target.files); e.target.value = ""; }} />
      {queue.length > 0 && (
        <div className="queue">
          <div className="queue-head">
            <span>{pending ? `Scoring… ${finished} of ${queue.length} done` : `${finished} processed${failed ? ` · ${failed} failed` : ""}`}</span>
            {!pending && <button className="link" onClick={onClear}>Clear</button>}
          </div>
          <div className="progress" aria-hidden><i style={{ width: `${(finished / queue.length) * 100}%` }} /></div>
          <ul>
            {queue.map((q) => (
              <li key={q.id} className={q.state}><span className="dot" />{q.name}<span className="muted"> {q.state === "working" ? "scoring…" : q.state === "waiting" ? "queued" : q.msg || ""}</span></li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
