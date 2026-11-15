"use client";
import { useCallback, useEffect, useState } from "react";
import type { CallDigest, Fundamentals, Ledger, Promise_, Snapshot, UsageRow } from "../lib/types";
import { balanceView, beneish, cagr, cashQuality, dimensionOf, DIMENSIONS, fiscalOnly, gap, last, marginRow, opRow, pct, piotroski, revenueRow, row, yoySeries } from "../lib/derive";
import { effective, inr, moves, reactionIndex, signed, stamp, tidy, type Settings } from "../lib/client";
import { CATEGORY_LABEL } from "../lib/classify";
import { Bars, Spark, Stamp, type SourceInfo } from "./ui";

interface Props {
  snap: Snapshot;
  symbol: string | null;
  setSymbol: (s: string | null) => void;
  openSource: (s: SourceInfo) => void;
  addUsage: (rows: UsageRow[]) => void;
  settings: Settings;
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const j = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
  return j as T;
}

const RULE: Record<string, string> = {
  kept: "Kept: the reported figure is at or inside the target for the period promised.",
  missed: "Missed: the period has closed and the reported figure is outside the target.",
  partial: "Partly: the direction was right but the figure fell short of the number given.",
  pending: "Open: the period promised has not closed, or its numbers are not yet reported. Full-year targets are never judged on one quarter.",
  unverifiable: "Can't check: the company does not report this figure, in its accounts or on later calls.",
};

function tally(l: Ledger) {
  const c = { kept: 0, missed: 0, partial: 0, pending: 0, unverifiable: 0 };
  for (const p of l.promises) c[p.status]++;
  return c;
}

function ScoreBar({ c }: { c: { kept: number; missed: number; partial: number; pending: number; unverifiable: number } }) {
  const total = c.kept + c.missed + c.partial + c.pending + c.unverifiable || 1;
  return (
    <div className="scorebar" aria-hidden="true">
      {(["kept", "partial", "missed", "pending", "unverifiable"] as const).map((k) =>
        c[k] ? <i key={k} className={`sb-${k}`} style={{ width: `${(c[k] / total) * 100}%` }} /> : null
      )}
    </div>
  );
}

export default function LedgerTab({ snap, symbol, setSymbol, openSource, addUsage, settings }: Props) {
  const [query, setQuery] = useState("");
  if (symbol) return <Company key={symbol} snap={snap} symbol={symbol} back={() => setSymbol(null)} openSource={openSource} addUsage={addUsage} settings={settings} />;

  const indexed = new Set(snap.ledgerIndex.map((r) => r.symbol));
  const others = snap.portfolio.filter((p) => !indexed.has(p.symbol));
  return (
    <div className="page">
      <header className="lede">
        <p className="label">Promise ledger</p>
        <h1 className="title">What they said, what they did</h1>
        <p className="asof">Every number management promised on an earnings call, checked against what the company later reported.</p>
        <form className="search" onSubmit={(e) => { e.preventDefault(); const s = query.trim().toUpperCase(); if (s) setSymbol(s); }}>
          <label htmlFor="sym">Research any NSE symbol</label>
          <div>
            <input id="sym" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="KAYNES" autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
            <button className="btn" type="submit">Research</button>
          </div>
        </form>
      </header>

      {snap.ledgerIndex.length > 0 && (
        <section>
          <h2>Ledgers ready to read</h2>
          <ul className="rows">
            {snap.ledgerIndex.map((r) => (
              <li key={r.symbol}>
                <button className="row env" onClick={() => setSymbol(r.symbol)}>
                  <span className="env-top">
                    <span className="env-name">{r.name}</span>
                    <span className="env-fig">{r.kept}<small> kept</small></span>
                  </span>
                  <ScoreBar c={r} />
                  <span className="env-foot">
                    <span>Missed {r.missed}{r.partial ? `, partly ${r.partial}` : ""}</span>
                    <span>Open {r.pending}, from {r.calls} calls</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>Your holdings</h2>
        <p className="hint">Numbers load instantly. The promise ledger is built when you ask for it, about a minute.</p>
        <ul className="rows">
          {others.map((p) => (
            <li key={p.symbol}>
              <button className="row" onClick={() => setSymbol(p.symbol)}>
                <span className="row-main"><span className="co">{p.symbol}</span> {p.name}</span>
                <span className="row-meta">{p.sector}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

interface Ev {
  key: string;
  kind: "matter" | "glance" | "move";
  i: number;
  date: string;
  label: string;
  move: number | null;
  info: SourceInfo;
}

function Timeline({ dates, close, events, onPick }: { dates: string[]; close: number[]; events: Ev[]; onPick: (e: Ev) => void }) {
  const W = 340, H = 120, n = close.length;
  const min = Math.min(...close), max = Math.max(...close), span = max - min || 1;
  const x = (i: number) => (i / (n - 1)) * (W - 8) + 4;
  const y = (v: number) => H - 14 - ((v - min) / span) * (H - 28);
  const d = close.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <figure className="timeline">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Closing price with filings marked">
        <path d={d} fill="none" />
        {events.filter((e) => e.i >= 0 && e.i < n).map((e) => (
          <g key={e.key} className={`ev ${e.kind}`} onClick={() => onPick(e)} tabIndex={0} role="button" aria-label={e.label}
            onKeyDown={(k) => k.key === "Enter" && onPick(e)}>
            <line x1={x(e.i)} x2={x(e.i)} y1={y(close[e.i])} y2={H - 6} />
            <circle cx={x(e.i)} cy={y(close[e.i])} r="5" />
            <circle cx={x(e.i)} cy={y(close[e.i])} r="13" className="hit" />
          </g>
        ))}
      </svg>
      <figcaption>
        <span>{dates[0]}</span>
        <span>₹{inr(min)} to ₹{inr(max)}</span>
        <span>{dates[n - 1]}</span>
      </figcaption>
    </figure>
  );
}

function Company({ snap, symbol, back, openSource, addUsage, settings }: { snap: Snapshot; symbol: string; back: () => void; openSource: (s: SourceInfo) => void; addUsage: (r: UsageRow[]) => void; settings: Settings }) {
  const [f, setF] = useState<Fundamentals | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(true);
  const [progress, setProgress] = useState<string[]>([]);
  const [building, setBuilding] = useState(false);
  const [showCant, setShowCant] = useState(false);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        let fund: Fundamentals | null = null;
        if (snap.cachedFundamentals.includes(symbol)) {
          fund = await getJson<Fundamentals>(`/data/fundamentals/${symbol}.json`).catch(() => null);
        }
        if (!fund) {
          const r = await getJson<{ fundamentals: Fundamentals; hasKey: boolean }>(`/api/research/company?symbol=${encodeURIComponent(symbol)}`);
          fund = r.fundamentals;
          if (!dead) setHasKey(r.hasKey);
        }
        if (dead) return;
        setF(fund);
        let l: Ledger | null = null;
        if (snap.ledgerIndex.some((r) => r.symbol === symbol)) l = await getJson<Ledger>(`/data/ledger/${symbol}.json`).catch(() => null);
        if (!l) {
          try {
            const raw = localStorage.getItem(`finn.ledger.${symbol}`);
            if (raw) l = JSON.parse(raw);
          } catch {}
        }
        if (!dead && l) setLedger(l);
      } catch (e) {
        if (!dead) setErr((e as Error).message);
      }
    })();
    return () => {
      dead = true;
    };
  }, [symbol, snap]);

  const build = useCallback(async () => {
    if (!f) return;
    setBuilding(true);
    setErr(null);
    const say = (s: string) => setProgress((p) => [...p, s]);
    try {
      const calls: CallDigest[] = [];
      const promises: Promise_[] = [];
      const todo = f.concalls.filter((c) => c.transcriptUrl).slice(0, 6);
      if (!todo.length) throw new Error("screener.in lists no earnings-call transcripts for this company, so there is nothing to check promises against.");
      for (const c of todo) {
        say(`Reading the ${c.period} call`);
        try {
          const r = await getJson<{ call: CallDigest; promises: Promise_[]; usage: UsageRow[] }>("/api/research/extract", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ symbol: f.symbol, name: f.name, concall: c }),
          });
          calls.push(r.call);
          promises.push(...r.promises);
          addUsage(r.usage);
          say(`${c.period}: ${r.promises.length} promises found`);
        } catch (e) {
          say(`${c.period}: skipped. ${(e as Error).message}`);
        }
      }
      if (!calls.length) throw new Error("None of the transcripts could be read.");
      say("Grading promises against reported numbers");
      const r = await getJson<{ ledger: Ledger; usage: UsageRow[] }>("/api/research/synthesize", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fundamentals: f, calls, promises }),
      });
      addUsage(r.usage);
      setLedger(r.ledger);
      try {
        localStorage.setItem(`finn.ledger.${symbol}`, JSON.stringify(r.ledger));
      } catch {}
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBuilding(false);
    }
  }, [f, symbol, addUsage]);

  if (err && !f)
    return (
      <div className="page">
        <button className="back" onClick={back}>All companies</button>
        <p className="empty">Could not load {symbol}. {err} Check the symbol matches its NSE ticker, then try again.</p>
      </div>
    );
  if (!f) return <div className="page"><button className="back" onClick={back}>All companies</button><p className="empty">Loading {symbol}</p></div>;

  const q = f.quarters;
  const rev = revenueRow(f, q), op = opRow(f, q), mar = marginRow(f, q), np = row(q, "Net Profit"), pbt = row(q, "Profit before tax");
  const n = q.periods.length;
  const tableSource = (label: string, period: string): SourceInfo => ({
    title: `${label}, ${period}`,
    lines: [
      { k: "Source", v: `screener.in standardised ${f.consolidated ? "consolidated" : "standalone"} tables, compiled from the company's exchange filings and annual reports` },
      { k: "Unit", v: "Rs crore" },
      { k: "Model involved", v: "None. This figure is arithmetic on reported numbers." },
    ],
    links: [{ label: "Open the company page on screener.in", href: f.url }],
  });
  const snapRows: [string, (number | null)[], boolean][] = [
    ["Revenue", rev, false],
    [f.isLender ? "Financing profit" : "EBITDA", op, false],
    ["PBT", pbt, false],
    ["PAT", np, false],
  ];
  const annual = fiscalOnly(f.annual);
  const ar = revenueRow(f, annual), an = row(annual, "Net Profit"), am = marginRow(f, annual);
  const ny = Math.min(6, annual.periods.length);
  const cq = cashQuality(f);
  const bv = balanceView(f);
  const price = snap.prices[symbol];
  const c = ledger ? tally(ledger) : null;
  const pio = piotroski(f), ben = beneish(f);
  const inPortfolio = snap.portfolio.some((x) => x.symbol === symbol);
  const mine = snap.announcements.filter((a) => a.symbol === symbol);

  const dims = !ledger ? [] : [...DIMENSIONS.map((d) => d.label), "Other"]
    .map((label) => {
      const ps = ledger.promises.filter((p) => dimensionOf(p.metric) === label);
      const kept = ps.filter((p) => p.status === "kept").length, missed = ps.filter((p) => p.status === "missed").length, partial = ps.filter((p) => p.status === "partial").length;
      return { label, kept, missed, partial, settled: kept + missed + partial };
    })
    .filter((d) => d.settled > 0);

  const people = mine.filter((a) => a.category === "management_change");
  const gov = [
    { label: "Promoter pledge or encumbrance", n: mine.filter((a) => a.category === "pledging").length, bad: true, note: "" },
    { label: "Auditor change", n: mine.filter((a) => /auditor/i.test(a.headline + a.body)).length, bad: true, note: "" },
    { label: "Board and senior management changes", n: people.length, bad: people.length >= 3, note: people.map((a) => a.person?.person).filter(Boolean).slice(0, 3).join(", ") },
    { label: "Insider or promoter share dealing", n: mine.filter((a) => a.category === "insider_trading").length, bad: false, note: "" },
    { label: "Legal or regulatory action", n: mine.filter((a) => a.category === "litigation").length, bad: true, note: "" },
    { label: "Related-party transactions", n: mine.filter((a) => /related party|regulation 23|section 188/i.test(a.headline + a.body)).length, bad: false, note: "" },
  ];

  const events: Ev[] = [];
  if (price) {
    for (const a of mine) {
      if (effective(a, settings).tier > 2) continue;
      const i = reactionIndex(price.dates, a.ts);
      events.push({
        key: a.id, kind: a.tier === 1 ? "matter" : "glance", i,
        date: stamp(a.ts), label: a.results ? "Results filed" : a.person ? `${a.person.person} ${a.person.change}` : a.summary || tidy(a.headline),
        move: i >= 1 ? (price.close[i] / price.close[i - 1] - 1) * 100 : null,
        info: {
          title: tidy(a.headline), quote: a.summary || a.body.slice(0, 280) || undefined,
          lines: [{ k: "Filed", v: `${stamp(a.ts)} on ${a.source}` }, { k: "Type", v: CATEGORY_LABEL[a.category] }, { k: "Why it ranks here", v: effective(a, settings).why }],
          links: a.url ? [{ label: "Open the filing", href: a.url }] : [],
        },
      });
    }
    for (const m of moves({ ...snap, prices: { [symbol]: price } }, settings, 0)) {
      if (m.explainedBy) continue;
      const i = price.dates.indexOf(m.date);
      events.push({
        key: `mv-${m.date}`, kind: "move", i, date: m.date, label: `Unusual move, no filing behind it`, move: m.pct,
        info: { title: `${symbol} ${signed(m.pct)} on ${m.volMult.toFixed(1)}× volume`, lines: [{ k: "Session", v: m.date }, { k: "Filings checked", v: "None above routine between the previous close and that evening" }] },
      });
    }
    events.sort((x, y) => x.i - y.i);
  }
  // Promises the reported numbers cannot settle are kept, but out of the way.
  const byCall = ledger
    ? ledger.calls.map((cl) => ({ cl, ps: ledger.promises.filter((p) => p.callPeriod === cl.period && p.status !== "unverifiable") }))
    : [];
  const cant = ledger ? ledger.promises.filter((p) => p.status === "unverifiable") : [];
  const TRACK = { ahead: "Tracking ahead", in_line: "Tracking in line", behind: "Tracking behind" } as const;
  const promiseRow = (p: Promise_) => (
    <li key={p.id}>
      <button onClick={() => openSource(promiseSource(p))}>
        <span className="p-text">
          {p.statement}
          {p.verdict && <em>{p.verdict}</em>}
          {p.status === "pending" && p.tracking && <span className={`trk ${p.tracking}`}>{TRACK[p.tracking]}</span>}
        </span>
        <Stamp status={p.status} />
      </button>
    </li>
  );

  const promiseSource = (p: Promise_): SourceInfo => ({
    title: p.statement,
    quote: `“${p.quote}”`,
    lines: [
      { k: "Said by", v: `${p.speaker}, on the ${p.callPeriod} earnings call` },
      { k: "Quote check", v: p.quoteVerified ? "Found word for word in the transcript" : "Not found word for word in the transcript; treat as a paraphrase" },
      ...(p.target ? [{ k: "Target", v: p.target }] : []),
      ...(p.horizon ? [{ k: "Due", v: p.horizon }] : []),
      ...(p.actual ? [{ k: "Reported", v: p.actual }] : []),
      ...(gap(p.targetLow, p.targetHigh, p.actualValue, p.unit) ? [{ k: "The arithmetic, done in code", v: gap(p.targetLow, p.targetHigh, p.actualValue, p.unit)! }] : []),
      ...(p.verdict ? [{ k: "Verdict", v: p.verdict }] : []),
      { k: "Grading rule", v: RULE[p.status] },
      ...(p.status === "pending" && p.tracking ? [{ k: "So far", v: TRACK[p.tracking] }] : []),
    ],
    links: p.callUrl ? [{ label: "Open the transcript", href: p.callUrl }] : [],
  });

  return (
    <div className="page">
      <button className="back" onClick={back}>All companies</button>
      <header className="lede co-head">
        <p className="label">{snap.portfolio.find((x) => x.symbol === symbol)?.sector || "Research"}</p>
        <h1 className="title">{f.name}</h1>
        <p className="asof">
          {symbol}
          {price ? `, last close ₹${inr(last(price.close), 2)}` : ""}
          {f.consolidated ? ", consolidated numbers" : ", standalone numbers"}
        </p>
        {ledger?.business && <p className="about">{ledger.business}</p>}
        <dl className="ratios">
          {Object.entries(f.ratios).filter(([k]) => /market cap|p\/e|roce|roe/i.test(k)).slice(0, 4).map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
      </header>

      <section>
        <h2>Promised versus delivered</h2>
        {ledger && c ? (
          <>
            {c.kept + c.missed + c.partial > 0 ? (
              <div className="saydo">
                <p className="figure sm">
                  {c.kept}
                  <span> of {c.kept + c.missed + c.partial} {c.kept + c.missed + c.partial === 1 ? "promise" : "promises"} kept</span>
                </p>
                <ScoreBar c={{ ...c, pending: 0, unverifiable: 0 }} />
              </div>
            ) : (
              <p className="summary">No promise has come due yet on the calls FINN read.</p>
            )}
            <div className="stamps big">
              <Stamp status="kept" count={c.kept} />
              {c.partial > 0 && <Stamp status="partial" count={c.partial} />}
              <Stamp status="missed" count={c.missed} />
              <Stamp status="pending" count={c.pending} />
            </div>
            {ledger.deliveredSummary && <p className="summary">{ledger.deliveredSummary}</p>}
            {byCall.map(({ cl, ps }) => (
              <div className="call" key={cl.period}>
                <h3>{cl.period} call{cl.quarterDiscussed ? `, ${cl.quarterDiscussed}` : ""}</h3>
                {cl.tone && <p className="tone">{cl.tone}{cl.pressing.length ? `. Analysts pressed on ${cl.pressing.join(", ")}` : ""}.</p>}
                {ps.length === 0 && <p className="hint">Nothing checkable was promised on this call.</p>}
                <ul className="promises">{ps.map(promiseRow)}</ul>
              </div>
            ))}
            {cant.length > 0 && (
              <div className="call">
                <button className="buried-head" aria-expanded={showCant} onClick={() => setShowCant((v) => !v)}>
                  <span>{cant.length} can&rsquo;t be checked</span>
                  <span className="muted">segment or volume targets the company does not report</span>
                  <span className="chev">{showCant ? "Hide" : "Show"}</span>
                </button>
                {showCant && <ul className="promises">{cant.map(promiseRow)}</ul>}
              </div>
            )}
            <p className="hint">Tap a promise for the exact words and the transcript. Built only from the company&rsquo;s own calls and reported numbers.</p>
          </>
        ) : (
          <div className="build">
            <p>
              {f.concalls.filter((x) => x.transcriptUrl).length} earnings-call transcripts are available for {f.name}.
              FINN reads the latest six, lists what management promised, and grades each promise against the numbers below.
            </p>
            {hasKey ? (
              <button className="btn" onClick={build} disabled={building}>{building ? "Building the ledger" : "Build the promise ledger"}</button>
            ) : (
              <p className="empty">The server has no model key, so the ledger cannot be built here. The numbers below need no model.</p>
            )}
            {progress.length > 0 && <ol className="progress">{progress.map((p, i) => <li key={i}>{p}</li>)}</ol>}
            {err && <p className="empty">The ledger could not be built. {err}</p>}
          </div>
        )}
      </section>

      {ledger && dims.length > 0 && (
        <section>
          <h2>Where their word holds</h2>
          <ul className="dims">
            {dims.map((d) => (
              <li key={d.label}>
                <span className="env-top">
                  <span>{d.label}</span>
                  <span className="capv">{d.kept} of {d.settled} kept</span>
                </span>
                <div className="scorebar" aria-hidden="true">
                  {d.kept > 0 && <i className="sb-kept" style={{ width: `${(d.kept / d.settled) * 100}%` }} />}
                  {d.partial > 0 && <i className="sb-partial" style={{ width: `${(d.partial / d.settled) * 100}%` }} />}
                  {d.missed > 0 && <i className="sb-missed" style={{ width: `${(d.missed / d.settled) * 100}%` }} />}
                </div>
              </li>
            ))}
          </ul>
          <p className="hint">Settled promises only. Guidance on the weaker lines deserves a discount when you model it.</p>
        </section>
      )}

      {ledger && (ledger.threads?.length ?? 0) > 0 && (
        <section>
          <h2>Guidance that was restated</h2>
          {ledger.threads!.map((t, i) => (
            <div className={`thread ${t.moved}`} key={i}>
              <h3>
                {t.metric}
                <span className={`stamp ${t.moved === "lowered" ? "s-missed" : t.moved === "raised" ? "s-kept" : "s-pending"}`}>
                  {t.moved === "lowered" ? "Walked down" : t.moved === "raised" ? "Raised" : "Held"}
                </span>
              </h3>
              <ol>
                {t.ids.map((id) => {
                  const p = ledger.promises.find((x) => x.id === id);
                  return p ? (
                    <li key={id}>
                      <button onClick={() => openSource(promiseSource(p))}>
                        <span>{p.callPeriod} call</span>
                        {p.target || p.statement}
                      </button>
                    </li>
                  ) : null;
                })}
              </ol>
              {t.note && <p className="summary">{t.note}</p>}
            </div>
          ))}
          <p className="hint">The same commitment tracked from call to call, so a target met only after being lowered is visible.</p>
        </section>
      )}

      {ledger && ledger.calls.some((c) => c.language) && (
        <section>
          <h2>How they spoke under questioning</h2>
          <table className="fin cost">
            <thead><tr><th>Call</th><th>Script</th><th>Q&amp;A</th><th>Shift</th></tr></thead>
            <tbody>
              {ledger.calls.filter((c) => c.language).map((c) => {
                const l = c.language!;
                const shift = l.hedgePrepared != null && l.hedgeQA != null ? l.hedgeQA - l.hedgePrepared : null;
                return (
                  <tr key={c.period}>
                    <th scope="row">{c.period}</th>
                    <td>{l.hedgePrepared == null ? "n/a" : `${l.hedgePrepared.toFixed(0)}%`}</td>
                    <td>{l.hedgeQA == null ? "n/a" : `${l.hedgeQA.toFixed(0)}%`}</td>
                    <td className={`delta ${shift != null && shift > 10 ? "down" : ""}`}>{shift == null ? "n/a" : `${shift > 0 ? "+" : "−"}${Math.abs(shift).toFixed(0)} pts`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="hint">
            Share of hedging words (might, hopefully, roughly) among hedging plus certainty words (will, definitely, committed), in management&rsquo;s own turns.
            A jump from script to Q&amp;A means they were less sure off-script. Counted in code; it is a prompt to read that Q&amp;A, not a finding about anyone&rsquo;s honesty.
          </p>
        </section>
      )}

      {ledger && ledger.divergences.length > 0 && (
        <section>
          <h2>Story versus numbers</h2>
          <ul className="diverge">
            {ledger.divergences.map((d, i) => (
              <li key={i} className={d.read}>
                <p><span>They say</span>{d.story}</p>
                <p><span>Numbers say</span>{d.numbers}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>Latest quarter, {q.periods[n - 1]}</h2>
        <table className="fin">
          <thead><tr><th /><th>Rs crore</th><th>QoQ</th><th>YoY</th></tr></thead>
          <tbody>
            {snapRows.map(([label, vals]) => (
              <tr key={label} onClick={() => openSource(tableSource(label, q.periods[n - 1]))}>
                <th scope="row">{label}</th>
                <td>{inr(vals[n - 1])}</td>
                <td className={`delta ${(pct(vals[n - 1], vals[n - 2]) ?? 0) >= 0 ? "up" : "down"}`}>{signed(pct(vals[n - 1], vals[n - 2]))}</td>
                <td className={`delta ${(pct(vals[n - 1], vals[n - 5]) ?? 0) >= 0 ? "up" : "down"}`}>{signed(pct(vals[n - 1], vals[n - 5]))}</td>
              </tr>
            ))}
            <tr onClick={() => openSource(tableSource(f.isLender ? "Financing margin" : "EBITDA margin", q.periods[n - 1]))}>
              <th scope="row">{f.isLender ? "Financing margin" : "EBITDA margin"}</th>
              <td>{mar[n - 1] == null ? "n/a" : `${mar[n - 1]}%`}</td>
              <td colSpan={2} className="muted">{mar[n - 5] == null ? "" : `${mar[n - 5]}% a year ago`}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {price && (
        <section>
          <h2>Price and what was filed</h2>
          <Timeline dates={price.dates} close={price.close} events={events} onPick={(e) => openSource(e.info)} />
          <ul className="rows">
            {events.slice(-5).reverse().map((e) => (
              <li key={e.key}>
                <button className="row" onClick={() => openSource(e.info)}>
                  <span className="row-main"><span className={`dot ${e.kind}`} />{e.label}</span>
                  <span className="row-meta">{e.date}, {e.move == null ? "no session yet" : `${signed(e.move)} that session`}</span>
                </button>
              </li>
            ))}
          </ul>
          {events.length === 0 && <p className="hint">Nothing above routine was filed in the period on the chart.</p>}
        </section>
      )}

      <section>
        <h2>Trajectory</h2>
        <div className="duo">
          <div>
            <p className="cap">Revenue growth, YoY by quarter</p>
            <Spark values={yoySeries(rev, 4).slice(4)} />
            <p className="capv">{signed(last(yoySeries(rev, 4)))} latest</p>
          </div>
          <div>
            <p className="cap">{f.isLender ? "Financing margin" : "EBITDA margin"} by quarter</p>
            <Spark values={mar} />
            <p className="capv">{last(mar) == null ? "n/a" : `${last(mar)}% latest`}</p>
          </div>
        </div>
        <p className="cap">Annual revenue, Rs crore</p>
        <Bars values={ar.slice(-ny)} labels={annual.periods.slice(-ny).map((p) => p.replace("Mar ", "FY"))} format={(v) => inr(v)} />
        <p className="summary">
          Revenue compounded {signed(cagr(ar, 3), 0)} a year over three years and profit {signed(cagr(an, 3), 0)}.
          {am.length > 3 && am[am.length - 1] != null && am[am.length - 4] != null
            ? ` Margin moved from ${am[am.length - 4]}% to ${am[am.length - 1]}%.`
            : ""}
        </p>
      </section>

      {cq && (
        <section>
          <h2>Do profits turn into cash?</h2>
          <p className="summary">
            {cq.conversion == null ? "Not computable." : `Over the last ${cq.years.length} years, ₹${cq.conversion.toFixed(0)} of operating cash came in for every ₹100 of reported profit.`}
            {cq.conversion != null && cq.conversion < 70 ? " That is low; profit is running ahead of cash." : ""}
          </p>
          <p className="cap">Cash from operations, Rs crore</p>
          <Bars values={cq.cfo} labels={cq.years.map((p) => p.replace("Mar ", "FY"))} tone="indigo" format={(v) => inr(v)} />
          <p className="cap">Net profit, Rs crore</p>
          <Bars values={cq.pat} labels={cq.years.map((p) => p.replace("Mar ", "FY"))} format={(v) => inr(v)} />
        </section>
      )}

      {bv && (
        <section>
          <h2>Balance sheet</h2>
          <p className="cap">Borrowings, Rs crore</p>
          <Bars values={bv.borrowings} labels={bv.years.map((p) => p.replace("Mar ", "FY").replace("Sep ", "H1 "))} tone="missed" format={(v) => inr(v)} />
          <dl className="ratios">
            <div><dt>Debt to equity</dt><dd>{last(bv.debtToEquity) == null ? "n/a" : (last(bv.debtToEquity) as number).toFixed(2)}</dd></div>
            {bv.cycle && <div><dt>{bv.cycle.label}</dt><dd>{last(bv.cycle.days) == null ? "n/a" : `${last(bv.cycle.days)} days`}</dd></div>}
            {bv.cycle && bv.cycle.days.length > 3 && <div><dt>Three years earlier</dt><dd>{bv.cycle.days[bv.cycle.days.length - 4] ?? "n/a"} days</dd></div>}
          </dl>
        </section>
      )}

      {(pio || ben) && (
        <section>
          <h2>Forensic checks</h2>
          {pio && (
            <>
              <p className="summary">
                <b className="capv">Piotroski {pio.score} of {pio.outOf}</b>, year to {pio.year}.{" "}
                {pio.score >= 7 ? "Strong on most tests." : pio.score <= 3 ? "Weak on most tests." : "Mixed."}
              </p>
              <ul className="checks">
                {pio.checks.map((c) => (
                  <li key={c.label} className={c.pass == null ? "na" : c.pass ? "yes" : "no"}>
                    <span>{c.label}{c.proxy ? " *" : ""}</span>
                    <span>{c.detail}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {ben && (
            <>
              <p className="summary">
                <b className="capv">Beneish M-Score {ben.m.toFixed(2)}</b>.{" "}
                {ben.zone === "high" ? "Above −1.78, the usual line for a closer look at earnings quality." : ben.zone === "grey" ? "Between −2.22 and −1.78: not flagged, not clear." : "Below −2.22: nothing flagged."}
              </p>
              <ul className="checks">
                {ben.parts.map((x) => (
                  <li key={x.key} className="na">
                    <span>{x.label}</span>
                    <span>{x.value.toFixed(2)}, {x.reads.toLowerCase()}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="hint">
            Computed in code from the reported tables, no model. * marks a stand-in: the standardised tables carry no current ratio or gross margin
            {ben ? ", and the M-Score's selling-cost index is held neutral, so treat it as approximate" : ""}. A screen, not a verdict.
          </p>
        </section>
      )}

      {inPortfolio && (
        <section>
          <h2>Governance signals</h2>
          <ul className="checks">
            {gov.map((g) => (
              <li key={g.label} className={g.n === 0 ? "yes" : g.bad ? "no" : "na"}>
                <span>{g.label}</span>
                <span>{g.n === 0 ? "None filed" : `${g.n} filed${g.note ? `: ${g.note}` : ""}`}</span>
              </li>
            ))}
          </ul>
          <p className="hint">From this company&rsquo;s exchange filings over the last {snap.days} days only. A longer history needs a longer ingest window.</p>
        </section>
      )}

      {ledger && (ledger.bull.length > 0 || ledger.bear.length > 0) && (
        <section>
          <h2>The case each way</h2>
          <div className="cases">
            <div className="bull"><h3>For</h3><ul>{ledger.bull.map((b, i) => <li key={i}>{b}</li>)}</ul></div>
            <div className="bear"><h3>Against</h3><ul>{ledger.bear.map((b, i) => <li key={i}>{b}</li>)}</ul></div>
          </div>
        </section>
      )}

      <section>
        <h2>Primary sources used</h2>
        <ul className="links">
          <li><a href={f.url} target="_blank" rel="noreferrer">Standardised financials on screener.in</a></li>
          {f.concalls.filter((x) => x.transcriptUrl).slice(0, 5).map((x) => (
            <li key={x.period}><a href={x.transcriptUrl!} target="_blank" rel="noreferrer">Earnings-call transcript, {x.period}</a></li>
          ))}
          {f.annualReports.slice(0, 2).map((x) => (
            <li key={x.url}><a href={x.url} target="_blank" rel="noreferrer">Annual report, {x.title}</a></li>
          ))}
        </ul>
        <p className="hint">No broker notes, news or research reports are read. The model is told to use only these documents.</p>
      </section>
    </div>
  );
}
