import type { Announcement, Category, Snapshot, Tier } from "./types";

export type Pref = "show" | "default" | "bury";

export interface Settings {
  volMult: number;
  pricePct: number;
  windowHours: number;
  prefs: Partial<Record<Category, Pref>>;
  dismissed: string[];
}

export const DEFAULTS: Settings = { volMult: 2, pricePct: 4, windowHours: 24, prefs: {}, dismissed: [] };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem("finn.settings");
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {}
  return DEFAULTS;
}
export function saveSettings(s: Settings) {
  try {
    localStorage.setItem("finn.settings", JSON.stringify(s));
  } catch {}
}

// The investor's own rules sit on top of FINN's ranking.
export function effective(a: Announcement, s: Settings): { tier: Tier; why: string } {
  const p = s.prefs[a.category];
  if (s.dismissed.includes(a.id)) return { tier: 3, why: "You buried this" };
  if (p === "bury") return { tier: 3, why: "You bury this type" };
  if (p === "show" && a.tier > 1) return { tier: 1, why: "You asked to always see this type" };
  return { tier: a.tier, why: a.why };
}

export interface Move {
  symbol: string;
  date: string;
  pct: number;
  volMult: number;
  priceHit: boolean;
  volHit: boolean;
  explainedBy: Announcement | null;
}


export function moves(snap: Snapshot, s: Settings, windowStart: number): Move[] {
  const out: Move[] = [];
  for (const [symbol, p] of Object.entries(snap.prices)) {
    const n = p.dates.length;
    for (let i = n - 1; i >= 21; i--) {
      const close = Date.parse(p.dates[i] + "T15:30:00+05:30");
      // Always judge the latest session; older ones only if inside the window.
      if (i < n - 1 && close < windowStart) break;
      // Never judge a session older than the filings we hold: with no filings to
      // check against, "unexplained" would mean nothing.
      if (close < Date.parse(snap.generatedAt) - snap.days * 86400000) break;
      const pct = (p.close[i] / p.close[i - 1] - 1) * 100;
      let avg = 0;
      for (let j = i - 20; j < i; j++) avg += p.volume[j];
      avg /= 20;
      const volMult = avg > 0 ? p.volume[i] / avg : 0;
      const priceHit = Math.abs(pct) >= s.pricePct;
      const volHit = volMult >= s.volMult;
      if (!priceHit && !volHit) continue;
      // Anything filed after the previous session closed could only be priced today,
      // however many days ago that was (weekends, holidays). Filings a few hours
      // after today's close count too: results often reach the exchange late.
      const from = Date.parse(p.dates[i - 1] + "T15:30:00+05:30");
      const to = close + 5 * 3600000;
      const explainedBy =
        snap.announcements
          .filter((a) => a.symbol === symbol && effective(a, s).tier <= 2)
          .filter((a) => {
            const t = Date.parse(a.ts);
            return t >= from && t <= to;
          })
          .sort((a, b) => a.tier - b.tier)[0] ?? null;
      out.push({ symbol, date: p.dates[i], pct, volMult, priceHit, volHit, explainedBy });
    }
  }
  return out.sort((a, b) => Number(Boolean(a.explainedBy)) - Number(Boolean(b.explainedBy)) || Math.abs(b.pct) - Math.abs(a.pct));
}

export const inr = (v: number | null | undefined, d = 0) =>
  v == null ? "n/a" : v.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });

export const signed = (v: number | null | undefined, d = 1) =>
  v == null ? "n/a" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}%`;

export function ago(ts: string, now: number): string {
  const m = Math.max(0, Math.round((now - Date.parse(ts)) / 60000));
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function stamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

export const WINDOWS: { hours: number; label: string }[] = [
  { hours: 24, label: "24 hours" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "7 days" },
  { hours: 720, label: "30 days" },
];

// Exchange subject lines are shouty and repetitive; tidy for display only.
export function tidy(h: string): string {
  let t = h.replace(/\s+/g, " ").replace(/^(announcement under regulation 30( \(lodr\)| of sebi \(?lodr\)?)?|disclosure under regulation 30)[\s\-:]*/i, "").trim();
  if (t === t.toUpperCase() && t.length > 8) t = t.charAt(0) + t.slice(1).toLowerCase();
  return t.length > 110 ? t.slice(0, 107) + "…" : t;
}

// ---------- Price reaction, coincidence scan and alerts ----------

// Index of the first trading session that could react to something filed at `ts`.
export function reactionIndex(dates: string[], ts: string): number {
  const t = Date.parse(ts);
  for (let i = 0; i < dates.length; i++) {
    if (Date.parse(dates[i] + "T15:30:00+05:30") >= t) return i;
  }
  return -1;
}

export interface Scan {
  explained: Move[];
  unexplained: Move[];
  quiet: { a: Announcement; pct: number }[]; // material filing, no price reaction
}

export function scan(snap: Snapshot, s: Settings, windowStart: number): Scan {
  const mv = moves(snap, s, windowStart);
  const quiet: Scan["quiet"] = [];
  for (const a of snap.announcements) {
    if (Date.parse(a.ts) < windowStart || effective(a, s).tier !== 1) continue;
    const p = snap.prices[a.symbol];
    if (!p) continue;
    const i = reactionIndex(p.dates, a.ts);
    if (i < 1) continue;
    const pct = (p.close[i] / p.close[i - 1] - 1) * 100;
    if (Math.abs(pct) < 1) quiet.push({ a, pct });
  }
  return { explained: mv.filter((m) => m.explainedBy), unexplained: mv.filter((m) => !m.explainedBy), quiet };
}

export interface Alert {
  id: string;
  symbol: string;
  title: string;
  why: string;
  evidence: string[];
  ts: number;
  ann?: Announcement;
}

export function buildAlerts(snap: Snapshot, s: Settings, since: number): Alert[] {
  const out: Alert[] = [];
  const asOf = Date.parse(snap.generatedAt);
  for (const m of moves(snap, s, asOf - 36 * 3600000)) {
    const ts = Date.parse(m.date + "T15:30:00+05:30");
    if (m.explainedBy || ts <= since) continue;
    out.push({
      id: `move-${m.symbol}-${m.date}`,
      symbol: m.symbol,
      title: `${m.symbol} ${signed(m.pct)} on ${m.volMult.toFixed(1)}× volume`,
      why: `Beyond your thresholds, and nothing ranked material was filed between the previous close and that evening. A move with nothing filed is the kind worth a call.`,
      evidence: [
        `Price and volume: Yahoo Finance end of day, ${m.date}; volume against its 20-day average`,
        `Filings checked: BSE corporate announcements for ${m.symbol}, none above routine`,
      ],
      ts,
    });
  }
  for (const a of snap.announcements) {
    const ts = Date.parse(a.ts);
    if (ts <= since || effective(a, s).tier !== 1) continue;
    let why = effective(a, s).why;
    if (a.results) {
      const y = a.results.yearAgo, c = a.results.current;
      const g = (n: number | null, d: number | null | undefined) => (n == null || !d ? null : ((n - d) / Math.abs(d)) * 100);
      why = `Revenue ${signed(g(c.revenue, y?.revenue))} and profit ${signed(g(c.pat, y?.pat))} against last year.` +
        (a.results.settles?.length ? ` This quarter settled ${a.results.settles.length} earlier promise${a.results.settles.length > 1 ? "s" : ""}.` : "");
    } else if (a.person) why = `${a.person.person} ${a.person.change} as ${a.person.role}.`;
    else if (a.summary) why = `${a.summary} ${why}.`;
    out.push({
      id: `ann-${a.id}`,
      symbol: a.symbol,
      title: `${a.company}: ${a.results ? "results" : a.person ? "management change" : tidy(a.headline).slice(0, 60)}`,
      why,
      evidence: [`Filed ${stamp(a.ts)} on ${a.source}`, a.classifiedBy === "rule" ? "Ranked by a fixed rule" : "Ranked by the low-cost model"],
      ts,
      ann: a,
    });
  }
  return out.sort((a, b) => b.ts - a.ts);
}
