"use client";
import { useEffect, useRef, type ReactNode } from "react";

export function Stat({ n, label, tone }: { n: number; label: string; tone?: "warn" }) {
  return <div className={`stat ${tone ?? ""}`}><b>{n}</b><span>{label}</span></div>;
}

export function ScoreBar({ v }: { v: number }) {
  const tone = v >= 65 ? "hi" : v >= 45 ? "mid" : "lo";
  return (
    <div className="scorebar" title={`${v} / 100`}>
      <div className="track"><div className={`fill ${tone}`} style={{ width: `${Math.max(2, v)}%` }} /></div>
      <span>{v}</span>
    </div>
  );
}

const SUGGESTION = { interview: "Interview", maybe: "Maybe", reject: "Reject" } as const;
export function SuggestionChip({ r }: { r: keyof typeof SUGGESTION | null }) {
  return r ? <span className={`chip ${r}`}>{SUGGESTION[r]}</span> : null;
}

/** Accessible dialog: Escape and backdrop click close it, focus moves in and is restored on close. */
export function Modal({ title, onClose, children, wide, locked }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; locked?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !locked) { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); prev?.focus?.(); };
  }, [onClose, locked]);
  return (
    <div className="modal-back" onClick={() => !locked && onClose()}>
      <div ref={ref} className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
