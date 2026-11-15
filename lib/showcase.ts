import fs from "node:fs";
import path from "node:path";
import type { Announcement, Ledger, Promise_, Snapshot } from "./types";
import { DEFAULTS, moves, type Move } from "./client";
import { LIST_PRICE, USD_INR } from "./gemini";

// Everything the start page shows is read from the same data the app uses, at
// build time. No number on that page is typed in by hand.

export interface Pick {
  company: string;
  symbol: string;
  p: Promise_;
}

export interface Showcase {
  filings: number;
  days: number;
  holdings: number;
  matter: number; // filings behind the cards ranked as mattering
  matterCards: number;
  glance: number;
  buried: number;
  byRule: number;
  cards: Announcement[]; // top cards, newest first
  resultsRead: number;
  resultsTotal: number;
  ledgers: number;
  promises: number;
  quotesVerified: number;
  settled: number;
  kept: number;
  missed: number;
  missedPick: Pick | null;
  keptPick: Pick | null;
  walkedDown: { company: string; symbol: string; metric: string; note: string } | null;
  unexplained: Move | null;
  costInr: number;
  calls: number;
  generatedAt: string;
}

function best(ledgers: Ledger[], status: "missed" | "kept"): Pick | null {
  const ranked = [...ledgers].sort(
    (a, b) => b.promises.filter((p) => p.status === status).length - a.promises.filter((p) => p.status === status).length
  );
  for (const l of ranked) {
    const c = l.promises
      .filter((p) => p.status === status && p.quoteVerified && p.actual && /\d/.test(p.actual) && p.quote.length >= 50 && p.quote.length <= 230)
      .sort(
        (a, b) =>
          Number(/revenue|margin|profit|cash|working/i.test(b.metric)) - Number(/revenue|margin|profit|cash|working/i.test(a.metric)) ||
          Number(/\d/.test(b.target)) - Number(/\d/.test(a.target)) ||
          a.quote.length - b.quote.length
      )[0];
    if (c) return { company: l.name, symbol: l.symbol, p: c };
  }
  return null;
}

export function loadShowcase(snap: Snapshot): Showcase {
  const dir = path.join(process.cwd(), "public", "data", "ledger");
  const ledgers: Ledger[] = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json") && (snap.sample || !/^SAMPLE/.test(f)))
        .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Ledger)
        .filter((l) => l.promises.length > 0)
    : [];
  const count = (t: number) => snap.announcements.filter((a) => a.tier === t).reduce((n, a) => n + 1 + (a.related?.length ?? 0), 0);
  const all = ledgers.flatMap((l) => l.promises);
  const results = snap.announcements.filter((a) => a.results);
  const thread = ledgers.flatMap((l) => (l.threads ?? []).filter((t) => t.moved === "lowered").map((t) => ({ company: l.name, symbol: l.symbol, metric: t.metric, note: t.note })))[0] ?? null;
  const asOf = Date.parse(snap.generatedAt);
  const cost = snap.usage.reduce((s, r) => s + ((r.inTok * LIST_PRICE[r.route].in + r.outTok * LIST_PRICE[r.route].out) / 1e6) * USD_INR, 0);
  return {
    filings: snap.stats.filings,
    days: snap.days,
    holdings: snap.portfolio.length,
    matter: count(1),
    matterCards: snap.announcements.filter((a) => a.tier === 1).length,
    glance: count(2),
    buried: count(3),
    byRule: snap.stats.byRule,
    cards: (() => {
      // One of each kind, so the preview shows the range of what FINN surfaces.
      const t1 = snap.announcements.filter((a) => a.tier === 1);
      const picks = [t1.find((a) => a.results?.source === "filing") ?? t1.find((a) => a.results), t1.find((a) => a.person), t1.find((a) => !a.results && !a.person && a.summary)];
      const out = picks.filter((a): a is Announcement => Boolean(a));
      for (const a of t1) if (out.length < 3 && !out.includes(a)) out.push(a);
      return out.slice(0, 3);
    })(),
    resultsRead: results.filter((a) => a.results!.source === "filing").length,
    resultsTotal: results.length,
    ledgers: ledgers.length,
    promises: all.length,
    quotesVerified: all.filter((p) => p.quoteVerified).length,
    settled: all.filter((p) => ["kept", "missed", "partial"].includes(p.status)).length,
    kept: all.filter((p) => p.status === "kept").length,
    missed: all.filter((p) => p.status === "missed").length,
    missedPick: best(ledgers, "missed"),
    keptPick: best(ledgers, "kept"),
    walkedDown: thread,
    unexplained: moves(snap, DEFAULTS, asOf - snap.days * 86400000).find((m) => !m.explainedBy) ?? null,
    costInr: cost,
    calls: snap.usage.length,
    generatedAt: snap.generatedAt,
  };
}
