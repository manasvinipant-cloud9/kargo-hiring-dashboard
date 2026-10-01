"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { IconClose } from "./icons";

/** Headline number in a frosted tile. */
export function Tile({ n, label, hot }: { n: number; label: string; hot?: boolean }) {
  return (
    <div className={`g-tile ${hot ? "is-hot" : ""}`}>
      <strong>{n}</strong>
      <span>{label}</span>
    </div>
  );
}

/** Circular score gauge (0–100). Colour follows the same bands as the suggestion thresholds. */
export function Ring({ value, size = 48, label }: { value: number; size?: number; label?: string }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const tone = value >= 65 ? "hi" : value >= 45 ? "mid" : "lo";
  return (
    <div className={`g-ring tone-${tone}`} style={{ width: size, height: size }} role="img" aria-label={`${label ?? "Score"} ${value} out of 100`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle className="trk" cx={size / 2} cy={size / 2} r={r} />
        <circle className="bar" cx={size / 2} cy={size / 2} r={r} strokeDasharray={`${(Math.max(2, value) / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <b>{Math.round(value)}</b>
    </div>
  );
}

/** Round monogram with a colour derived from the name, so rows are easy to tell apart. */
export function Avatar({ name }: { name: string }) {
  const initials = name.replace(/\.[a-z]+$/i, "").split(/[\s_.-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return <span className="g-avatar" style={{ background: `linear-gradient(135deg, hsl(${h} 80% 62%), hsl(${(h + 48) % 360} 80% 55%))` }} aria-hidden="true">{initials}</span>;
}

const VIEW = { interview: "Strong fit", maybe: "Borderline", reject: "Weak fit" } as const;
export function ViewPill({ r }: { r: keyof typeof VIEW | null }) {
  return r ? <span className={`g-pill view-${r}`}>{VIEW[r]}</span> : null;
}

/** Accessible glass dialog: Escape and backdrop click close it, focus moves in and is restored on close. */
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
    <div className="g-veil" onClick={() => !locked && onClose()}>
      <div ref={ref} className={`g-dialog g-glass ${wide ? "is-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header><h2>{title}</h2>{!locked && <button className="g-icon" onClick={onClose} aria-label="Close"><IconClose /></button>}</header>
        {children}
      </div>
    </div>
  );
}
