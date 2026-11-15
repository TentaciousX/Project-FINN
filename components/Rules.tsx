"use client";
import type { Snapshot, UsageRow } from "../lib/types";
import { ALL_CATEGORIES, CATEGORY_LABEL } from "../lib/classify";
import { LIST_PRICE, USD_INR } from "../lib/gemini";
import { stamp, type Pref, type Settings } from "../lib/client";

interface Props {
  snap: Snapshot;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  liveUsage: UsageRow[];
}

function costInr(r: UsageRow) {
  const p = LIST_PRICE[r.route];
  return ((r.inTok * p.in + r.outTok * p.out) / 1e6) * USD_INR;
}

export default function Rules({ snap, settings, update, liveUsage }: Props) {
  const usage = [...snap.usage, ...liveUsage];
  const steps = new Map<string, { calls: number; inTok: number; outTok: number; inr: number; route: string }>();
  let total = 0, naive = 0, sentWithNaive = 0;
  for (const r of usage) {
    const s = steps.get(r.step) ?? { calls: 0, inTok: 0, outTok: 0, inr: 0, route: r.route };
    s.calls++;
    s.inTok += r.inTok;
    s.outTok += r.outTok;
    s.inr += costInr(r);
    steps.set(r.step, s);
    total += costInr(r);
    if (r.naiveInTok) {
      naive += r.naiveInTok;
      sentWithNaive += r.inTok;
    }
  }
  // What the same work would cost with no rules, no page selection and the strong model throughout.
  const strong = LIST_PRICE.strong;
  const lazy = usage.reduce((sum, r) => sum + (((r.naiveInTok ?? r.inTok) * strong.in + r.outTok * strong.out) / 1e6) * USD_INR, 0)
    + ((snap.stats.byRule * 350 * strong.in + snap.stats.byRule * 60 * strong.out) / 1e6) * USD_INR;
  const setPref = (cat: string, p: Pref) => update({ prefs: { ...settings.prefs, [cat]: p } });

  return (
    <div className="page">
      <header className="lede">
        <p className="label">Your rules</p>
        <h1 className="title">You decide what counts</h1>
        <p className="asof">FINN ranks filings its own way. Anything you set here overrides it, on this phone.</p>
      </header>

      <section>
        <h2>Unusual moves</h2>
        <div className="field">
          <label htmlFor="pp">Flag a daily price move beyond <b>±{settings.pricePct}%</b></label>
          <input id="pp" type="range" min={1} max={10} step={0.5} value={settings.pricePct} onChange={(e) => update({ pricePct: Number(e.target.value) })} />
        </div>
        <div className="field">
          <label htmlFor="vm">Flag volume above <b>{settings.volMult}×</b> its 20-day average</label>
          <input id="vm" type="range" min={1.25} max={5} step={0.25} value={settings.volMult} onChange={(e) => update({ volMult: Number(e.target.value) })} />
        </div>
      </section>

      <section>
        <h2>Filing types</h2>
        <p className="hint">Always show lifts a type into Matters. Bury hides it with the routine paperwork.</p>
        <ul className="prefs">
          {ALL_CATEGORIES.map((c) => {
            const cur = settings.prefs[c] ?? "default";
            return (
              <li key={c}>
                <span>{CATEGORY_LABEL[c]}</span>
                <div className="seg small" role="group" aria-label={CATEGORY_LABEL[c]}>
                  {(["show", "default", "bury"] as Pref[]).map((p) => (
                    <button key={p} aria-pressed={cur === p} onClick={() => setPref(c, p)}>
                      {p === "show" ? "Always show" : p === "default" ? "FINN decides" : "Bury"}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
        {settings.dismissed.length > 0 && (
          <button className="btn ghost" onClick={() => update({ dismissed: [] })}>
            Restore {settings.dismissed.length} filing{settings.dismissed.length > 1 ? "s" : ""} you buried
          </button>
        )}
      </section>

      <section>
        <h2>What this brief cost</h2>
        <p className="summary">
          {usage.length} model calls, about ₹{total.toFixed(2)} at list price. On the free tier it billed nothing.
          {lazy > total * 1.2 ? ` Sending everything to the stronger model unfiltered would have cost about ₹${lazy.toFixed(2)}.` : ""}
        </p>
        <table className="fin cost">
          <thead><tr><th>Step</th><th>Calls</th><th>Tokens in</th><th>₹</th></tr></thead>
          <tbody>
            {[...steps.entries()].map(([k, s]) => (
              <tr key={k}>
                <th scope="row">{k}<small>{s.route === "strong" ? "stronger model" : "low-cost model"}</small></th>
                <td>{s.calls}</td>
                <td>{s.inTok.toLocaleString("en-IN")}</td>
                <td>{s.inr.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="facts">
          <li>{snap.stats.byRule} of {snap.stats.filings} filings were sorted by fixed rules, with no model call.</li>
          {naive > 0 && <li>Sending only the relevant pages and speaker turns cut input by {Math.round((1 - sentWithNaive / naive) * 100)}%.</li>}
          <li>Buried filings get no summary, so noise costs nothing.</li>
          {snap.stats.cacheHits > 0 && <li>{snap.stats.cacheHits} calls in the last refresh were answered from cache.</li>}
          {snap.stats.models && <li>Low-cost model: {snap.stats.models.cheap}. Stronger model, used once per company: {snap.stats.models.strong}.</li>}
        </ul>
      </section>

      <section>
        <h2>Data</h2>
        <ul className="facts">
          <li>Snapshot taken {stamp(snap.generatedAt)}, covering {snap.days} days of filings.</li>
          <li>Filings: {Object.entries(snap.stats.sources).map(([k, v]) => `${v} from ${k}`).join(", ") || "none"}.</li>
          <li>Prices: Yahoo Finance end of day. Fundamentals and transcripts: screener.in.</li>
          <li>{snap.portfolio.length} holdings: {snap.portfolio.map((p) => p.symbol).join(", ")}.</li>
        </ul>
      </section>
    </div>
  );
}
