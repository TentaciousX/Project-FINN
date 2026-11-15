"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Announcement, Snapshot, UsageRow } from "../lib/types";
import { buildAlerts, DEFAULTS, loadSettings, saveSettings, type Settings } from "../lib/client";
import Today from "./Today";
import LedgerTab from "./LedgerTab";
import Rules from "./Rules";
import { SourceSheet, type SourceInfo } from "./ui";

type Tab = "today" | "ledger" | "rules";

const ICONS: Record<Tab, React.ReactNode> = {
  today: <path d="M4 11.5 12 5l8 6.5V20h-5.5v-5h-5v5H4z" />,
  ledger: <path d="M5 6h2M10 6h9M5 12h2M10 12h9M5 18h2M10 18h9" />,
  rules: <path d="M4 7h10M18 7h2M4 17h2M10 17h10M16 4.5v5M8 14.5v5" />,
};

export default function App({ snap }: { snap: Snapshot }) {
  const [tab, setTab] = useState<Tab>("today");
  const [symbol, setSymbol] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [source, setSource] = useState<SourceInfo | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [liveUsage, setLiveUsage] = useState<UsageRow[]>([]);

  useEffect(() => {
    setSettings(loadSettings());
    const read = () => {
      const h = window.location.hash.replace(/^#/, "");
      const [t, s] = h.split("/");
      if (t === "ledger" || t === "rules" || t === "today") {
        setTab(t);
        setSymbol(t === "ledger" && s ? decodeURIComponent(s).toUpperCase() : null);
      }
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  const go = useCallback((t: Tab, s: string | null = null) => {
    window.location.hash = s ? `${t}/${encodeURIComponent(s)}` : t;
    window.scrollTo(0, 0);
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((cur) => {
      const next = { ...cur, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const bury = useCallback(
    (a: Announcement) => {
      setSource(null);
      update({ dismissed: [...settings.dismissed.filter((x) => x !== a.id), a.id] });
      setToast({ text: "Buried", undo: () => update({ dismissed: settings.dismissed.filter((x) => x !== a.id) }) });
    },
    [settings.dismissed, update]
  );

  // Alerts are everything that crossed the bar since the investor last marked them read.
  const [seen, setSeen] = useState<number | null>(null);
  useEffect(() => {
    const raw = Number(localStorage.getItem("finn.seen") || 0);
    setSeen(raw || Date.parse(snap.generatedAt) - 72 * 3600000);
  }, [snap.generatedAt]);
  const alerts = useMemo(() => (seen == null ? [] : buildAlerts(snap, settings, seen)), [snap, settings, seen]);
  const ackAlerts = useCallback(() => {
    const t = Date.parse(snap.generatedAt);
    try {
      localStorage.setItem("finn.seen", String(t));
    } catch {}
    setSeen(t);
  }, [snap.generatedAt]);
  // If the investor allowed notifications, raise one per new snapshot.
  useEffect(() => {
    if (!alerts.length || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    if (localStorage.getItem("finn.notified") === snap.generatedAt) return;
    try {
      new Notification(`FINN: ${alerts.length} alert${alerts.length > 1 ? "s" : ""}`, { body: `${alerts[0].title}. ${alerts[0].why}`.slice(0, 180) });
      localStorage.setItem("finn.notified", snap.generatedAt);
    } catch {}
  }, [alerts, snap.generatedAt]);

  const addUsage = useCallback((rows: UsageRow[]) => setLiveUsage((u) => [...u, ...rows]), []);

  return (
    <div className="shell">
      {snap.sample && (
        <p className="banner">Sample data with invented companies. Run <code>npm run ingest</code> to load real filings.</p>
      )}
      <header className="topbar">
        <a href="/">FINN</a>
        <span>{snap.portfolio.length} holdings</span>
      </header>
      <main>
        {tab === "today" && (
          <Today snap={snap} settings={settings} update={update} openSource={setSource}
            openCompany={(s) => { setSource(null); go("ledger", s); }} bury={bury} alerts={alerts} ackAlerts={ackAlerts} />
        )}
        {tab === "ledger" && (
          <LedgerTab snap={snap} symbol={symbol} setSymbol={(s) => go("ledger", s)} openSource={setSource} addUsage={addUsage} settings={settings} />
        )}
        {tab === "rules" && <Rules snap={snap} settings={settings} update={update} liveUsage={liveUsage} alerts={alerts} />}
      </main>

      {toast && (
        <div className="toast" role="status">
          {toast.text}
          {toast.undo && <button onClick={() => { toast.undo!(); setToast(null); }}>Undo</button>}
        </div>
      )}

      <nav className="tabs" aria-label="Sections">
        {([["today", "Today"], ["ledger", "Ledger"], ["rules", "Rules"]] as [Tab, string][]).map(([t, label]) => (
          <button key={t} aria-current={tab === t ? "page" : undefined} onClick={() => go(t)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">{ICONS[t]}</svg>
            {label}
          </button>
        ))}
      </nav>

      <SourceSheet info={source} onClose={() => setSource(null)} />
    </div>
  );
}
