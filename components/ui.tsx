"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PromiseStatus } from "../lib/types";

export interface SourceInfo {
  title: string;
  lines: { k: string; v: string }[];
  quote?: string;
  links?: { label: string; href: string }[];
  actions?: { label: string; run: () => void; danger?: boolean }[];
}

export function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-wrap" role="dialog" aria-modal="true">
      <button className="sheet-scrim" aria-label="Close" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-grip" />
        {children}
        <button className="btn ghost full" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

export function SourceSheet({ info, onClose }: { info: SourceInfo | null; onClose: () => void }) {
  return (
    <Sheet open={Boolean(info)} onClose={onClose}>
      {info && (
        <>
          <h3 className="sheet-title">{info.title}</h3>
          {info.quote && <blockquote className="quote">{info.quote}</blockquote>}
          <dl className="kv">
            {info.lines.map((l, i) => (
              <div key={i}>
                <dt>{l.k}</dt>
                <dd>{l.v}</dd>
              </div>
            ))}
          </dl>
          {info.links?.map((l) => (
            <a key={l.href + l.label} className="btn full" href={l.href} target="_blank" rel="noreferrer">
              {l.label}
            </a>
          ))}
          {info.actions?.map((a) => (
            <button key={a.label} className={`btn full ${a.danger ? "danger" : "ghost"}`} onClick={a.run}>
              {a.label}
            </button>
          ))}
        </>
      )}
    </Sheet>
  );
}

const STATUS_WORD: Record<PromiseStatus, string> = {
  kept: "Kept",
  missed: "Missed",
  partial: "Partly",
  pending: "Open",
  unverifiable: "Can't check",
};

// The one loud element in the app: a rubber stamp on every promise.
export function Stamp({ status, count }: { status: PromiseStatus; count?: number }) {
  return (
    <span className={`stamp s-${status}`}>
      {count != null ? `${count} ` : ""}
      {count != null ? STATUS_WORD[status].toLowerCase() : STATUS_WORD[status]}
    </span>
  );
}

export function Bars({
  values, labels, tone = "ink", height = 64, format,
}: { values: (number | null)[]; labels: string[]; tone?: "ink" | "kept" | "missed" | "indigo"; height?: number; format?: (v: number) => string }) {
  const nums = values.map((v) => v ?? 0);
  const max = Math.max(...nums.map(Math.abs), 1e-9);
  const hasNeg = nums.some((v) => v < 0);
  const zero = hasNeg ? height / 2 : height;
  const scale = (hasNeg ? height / 2 : height) / max;
  const w = 100 / values.length;
  return (
    <figure className="chart">
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ height }} aria-hidden="true">
        {nums.map((v, i) => {
          const h = Math.abs(v) * scale;
          return (
            <rect key={i} x={i * w + w * 0.16} width={w * 0.68} y={v >= 0 ? zero - h : zero} height={Math.max(h, 0.6)}
              className={`bar t-${v < 0 ? "missed" : tone}`} opacity={i === nums.length - 1 ? 1 : 0.55} />
          );
        })}
        {hasNeg && <line x1="0" x2="100" y1={zero} y2={zero} className="axis" />}
      </svg>
      <figcaption>
        {labels.map((l, i) => (
          <span key={i}>
            <b>{values[i] == null ? "n/a" : format ? format(values[i] as number) : String(values[i])}</b>
            {l}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

export function Spark({ values, height = 36 }: { values: (number | null)[]; height?: number }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v != null);
  if (pts.length < 2) return null;
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * 100;
  const y = (v: number) => height - 3 - ((v - min) / span) * (height - 6);
  const d = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const lastP = pts[pts.length - 1];
  return (
    <svg className="spark" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ height }} aria-hidden="true">
      <path d={d} fill="none" vectorEffect="non-scaling-stroke" />
      <circle cx={x(lastP.i)} cy={y(lastP.v)} r="1.6" />
    </svg>
  );
}

// Drag a card left to bury it. Tap still works; keyboard users get the same
// action inside the detail sheet.
export function Swipe({ onBury, children }: { onBury: () => void; children: ReactNode }) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number; locked: boolean | null } | null>(null);
  const moved = useRef(false);
  return (
    <div className="swipe">
      <div className="swipe-under" aria-hidden="true">Bury</div>
      <div
        className="swipe-top"
        style={{ transform: `translateX(${dx}px)`, transition: start.current ? "none" : "transform 160ms ease-out" }}
        onPointerDown={(e) => {
          start.current = { x: e.clientX, y: e.clientY, locked: null };
          moved.current = false;
        }}
        onPointerMove={(e) => {
          const s = start.current;
          if (!s) return;
          const ddx = e.clientX - s.x, ddy = e.clientY - s.y;
          if (s.locked == null && Math.abs(ddx) + Math.abs(ddy) > 8) s.locked = Math.abs(ddx) > Math.abs(ddy);
          if (s.locked) {
            moved.current = true;
            setDx(Math.min(0, ddx));
          }
        }}
        onPointerUp={() => {
          const far = dx < -96;
          start.current = null;
          setDx(0);
          if (far) onBury();
        }}
        onPointerCancel={() => {
          start.current = null;
          setDx(0);
        }}
        onClickCapture={(e) => {
          if (moved.current) {
            e.stopPropagation();
            e.preventDefault();
            moved.current = false;
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
