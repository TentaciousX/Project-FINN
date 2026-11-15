"use client";
import { useMemo, useState } from "react";
import type { Announcement, PeriodFigures, ResultsCard, Snapshot } from "../lib/types";
import { CATEGORY_LABEL } from "../lib/classify";
import { pct } from "../lib/derive";
import { ago, effective, inr, moves, signed, stamp, tidy, WINDOWS, type Settings } from "../lib/client";
import { Stamp, Swipe, type SourceInfo } from "./ui";

interface Props {
  snap: Snapshot;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  openSource: (s: SourceInfo) => void;
  openCompany: (symbol: string) => void;
  bury: (a: Announcement) => void;
}

const Delta = ({ v }: { v: number | null }) => (
  <span className={`delta ${v == null ? "" : v >= 0 ? "up" : "down"}`}>{signed(v)}</span>
);

function ResultsBlock({ r, onSource }: { r: ResultsCard; onSource: () => void }) {
  const rows: [string, keyof PeriodFigures][] = [
    ["Revenue", "revenue"],
    [r.isLender ? "EBITDA" : "EBITDA", "ebitda"],
    ["PBT", "pbt"],
    ["PAT", "pat"],
  ];
  const tally = { kept: 0, missed: 0, partial: 0 };
  for (const s of r.settles ?? []) if (s.status in tally) tally[s.status as keyof typeof tally]++;
  return (
    <div className="results">
      <table>
        <thead>
          <tr>
            <th scope="col">{r.current.label || "This quarter"}</th>
            <th scope="col">Rs crore</th>
            <th scope="col">QoQ</th>
            <th scope="col">YoY</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, k]) => {
            const cur = r.current[k] as number | null;
            if (k === "ebitda" && r.isLender)
              return (
                <tr key={k}>
                  <th scope="row">EBITDA</th>
                  <td colSpan={3} className="muted">not meaningful for a lender</td>
                </tr>
              );
            return (
              <tr key={k}>
                <th scope="row">{label}</th>
                <td>{inr(cur)}</td>
                <td><Delta v={pct(cur, r.previous?.[k] as number | null)} /></td>
                <td><Delta v={pct(cur, r.yearAgo?.[k] as number | null)} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {(r.settles?.length ?? 0) > 0 && (
        <div className="settles">
          <p>This quarter settled {r.settles!.length} of management&rsquo;s earlier promises.</p>
          <div className="stamps">
            {tally.kept > 0 && <Stamp status="kept" count={tally.kept} />}
            {tally.partial > 0 && <Stamp status="partial" count={tally.partial} />}
            {tally.missed > 0 && <Stamp status="missed" count={tally.missed} />}
          </div>
          <ul>
            {r.settles!.slice(0, 3).map((s) => (
              <li key={s.id} className={`dot-${s.status}`}>{s.statement}</li>
            ))}
          </ul>
        </div>
      )}
      <button className="src" onClick={(e) => { e.stopPropagation(); onSource(); }}>
        {r.source === "filing" ? "Read from the filing" : "From the standardised quarterly table"}, {r.basis.toLowerCase()}
        {r.crossChecked === true ? ", revenue cross-checked" : r.crossChecked === false ? ", revenue differs from screener" : ""}
      </button>
    </div>
  );
}

const dayLabel = (ms: number) =>
  new Date(ms).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

export default function Today({ snap, settings, update, openSource, openCompany, bury }: Props) {
  const asOf = Date.parse(snap.generatedAt);
  const windowStart = asOf - settings.windowHours * 3600000;
  const [showBuried, setShowBuried] = useState(false);

  const { t1, t2, t3, total } = useMemo(() => {
    const inWin = snap.announcements.filter((a) => Date.parse(a.ts) >= windowStart);
    const withEff = inWin.map((a) => ({ a, e: effective(a, settings) }));
    const total = inWin.reduce((n, a) => n + 1 + (a.related?.length ?? 0), 0);
    return {
      t1: withEff.filter((x) => x.e.tier === 1),
      t2: withEff.filter((x) => x.e.tier === 2),
      t3: withEff.filter((x) => x.e.tier === 3),
      total,
    };
  }, [snap, settings, windowStart]);

  const mv = useMemo(() => moves(snap, settings, windowStart), [snap, settings, windowStart]);
  const buriedCount = t3.reduce((n, x) => n + 1 + (x.a.related?.length ?? 0), 0);
  const buriedKinds = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of t3) m.set(CATEGORY_LABEL[x.a.category], (m.get(CATEGORY_LABEL[x.a.category]) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [t3]);

  const detail = (a: Announcement, why: string): SourceInfo => ({
    title: tidy(a.headline),
    quote: a.summary || (a.body ? a.body.slice(0, 320) : undefined),
    lines: [
      { k: "Company", v: `${a.company} (${a.symbol})` },
      { k: "Filed", v: `${stamp(a.ts)} on ${a.source}` },
      { k: "Type", v: CATEGORY_LABEL[a.category] },
      { k: "Why it ranks here", v: why },
      { k: "Sorted by", v: a.classifiedBy === "rule" ? "A fixed rule on the subject line, no model call" : "The low-cost model, in a batch" },
      ...(a.related?.length ? [{ k: "Folded under it", v: a.related.map((r) => tidy(r.headline)).join("; ") }] : []),
    ],
    links: a.url ? [{ label: "Open the filing", href: a.url }] : [],
    actions: [
      { label: `Open ${a.symbol} ledger`, run: () => openCompany(a.symbol) },
      { label: "Bury this filing", run: () => bury(a), danger: true },
    ],
  });

  const resultsSource = (a: Announcement): SourceInfo => {
    const r = a.results!;
    return {
      title: `${a.company}: where these numbers come from`,
      lines: [
        { k: "Source", v: r.source === "filing" ? "The results PDF filed with the exchange. Only the pages holding the results table were sent to the low-cost model." : "screener.in standardised quarterly table (the filing could not be read)." },
        { k: "Basis", v: `${r.basis}, ${r.unit}` },
        { k: "EBITDA", v: r.source === "filing" ? "Not a printed line. Computed as profit before exceptional items and tax + finance costs + depreciation − other income." : "Operating profit as standardised by screener.in." },
        { k: "Compared with", v: `${r.previous?.label || "previous quarter"} (QoQ) and ${r.yearAgo?.label || "same quarter last year"} (YoY), both taken from the same statement` },
        { k: "Cross-check", v: r.crossChecked == null ? "Not run" : r.crossChecked ? "Revenue agrees with the screener.in table within 2%" : "Revenue differs from the screener.in table by more than 2%; read the filing" },
      ],
      links: r.filingUrl ? [{ label: "Open the results filing", href: r.filingUrl }] : [],
    };
  };

  const speak = () => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const parts = [
      `${total} filings in the last ${WINDOWS.find((w) => w.hours === settings.windowHours)?.label}. ${t1.length} matter.`,
      ...t1.slice(0, 5).map(({ a }) => {
        if (a.results) {
          const y = pct(a.results.current.revenue, a.results.yearAgo?.revenue);
          const p = pct(a.results.current.pat, a.results.yearAgo?.pat);
          return `${a.company} results. Revenue ${y == null ? "" : `${y >= 0 ? "up" : "down"} ${Math.abs(y).toFixed(0)} percent`} year on year, profit ${p == null ? "" : `${p >= 0 ? "up" : "down"} ${Math.abs(p).toFixed(0)} percent`}.`;
        }
        if (a.person) return `${a.company}. ${a.person.person} ${a.person.change} as ${a.person.role}.`;
        return `${a.company}. ${a.summary || tidy(a.headline)}.`;
      }),
      ...mv.filter((m) => !m.explainedBy).slice(0, 3).map((m) => `${m.symbol} moved ${Math.abs(m.pct).toFixed(1)} percent ${m.pct >= 0 ? "up" : "down"} with no filing to explain it.`),
    ];
    const u = new SpeechSynthesisUtterance(parts.join(" "));
    u.rate = 1.02;
    window.speechSynthesis.speak(u);
  };

  return (
    <div className="page">
      <header className="lede">
        <p className="label">Filings that matter</p>
        <h1 className="figure">
          {t1.length}
          <span> of {total} filed</span>
        </h1>
        <div className="range">
          <span>{dayLabel(windowStart)}</span>
          <i><b style={{ width: `${total ? Math.max(4, Math.round(((t1.length + t2.length) / total) * 100)) : 0}%` }} /></i>
          <span>{dayLabel(asOf)}</span>
        </div>
        <p className="asof">
          {total ? `${total - t1.length - t2.length} of ${total} buried as routine. ` : ""}
          {snap.portfolio.length} holdings, as of {stamp(snap.generatedAt)}.
          <button className="link" onClick={speak}>Play as audio</button>
        </p>
        <div className="seg" role="group" aria-label="Time window">
          {WINDOWS.filter((w) => w.hours <= snap.days * 24).map((w) => (
            <button key={w.hours} aria-pressed={settings.windowHours === w.hours} onClick={() => update({ windowHours: w.hours })}>
              {w.label}
            </button>
          ))}
        </div>
      </header>

      {mv.length > 0 && (
        <section>
          <h2>Unusual moves</h2>
          <p className="hint">Beyond ±{settings.pricePct}% in a day, or volume over {settings.volMult}× its 20-day average. You set these in Rules.</p>
          <ul className="moves">
            {mv.slice(0, 6).map((m) => (
              <li key={m.symbol + m.date}>
                <button onClick={() => (m.explainedBy ? openSource(detail(m.explainedBy, effective(m.explainedBy, settings).why)) : openCompany(m.symbol))}>
                  <span className="sym">{m.symbol}</span>
                  <span className={`delta ${m.pct >= 0 ? "up" : "down"}`}>{signed(m.pct)}</span>
                  <span className="vol">{m.volMult.toFixed(1)}× volume</span>
                  <span className={m.explainedBy ? "explained" : "unexplained"}>
                    {m.explainedBy ? `Explained: ${CATEGORY_LABEL[m.explainedBy.category].toLowerCase()}` : "No filing explains it"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>Matters <small>{t1.length}</small></h2>
        {t1.length === 0 && (
          <p className="empty">
            Nothing material was filed in this window.
            {settings.windowHours < 168 && snap.days >= 7 && (
              <button className="link" onClick={() => update({ windowHours: 168 })}>Widen to 7 days</button>
            )}
          </p>
        )}
        {t1.map(({ a, e }) => (
          <Swipe key={a.id} onBury={() => bury(a)}>
            <article className="card" onClick={() => openSource(detail(a, e.why))} tabIndex={0} role="button"
              onKeyDown={(ev) => ev.key === "Enter" && openSource(detail(a, e.why))}>
              <div className="card-top">
                <span className="co">{a.company}</span>
                <span className="when">{ago(a.ts, asOf)}</span>
              </div>
              <p className="tag">{CATEGORY_LABEL[a.category]}</p>
              {a.results ? (
                <ResultsBlock r={a.results} onSource={() => openSource(resultsSource(a))} />
              ) : a.person ? (
                <div className="person">
                  <h3>{a.person.person}</h3>
                  <p className="role">
                    {a.person.change.charAt(0).toUpperCase() + a.person.change.slice(1)} as {a.person.role}
                    {a.person.effective ? `, effective ${a.person.effective}` : ""}
                  </p>
                  {a.person.bio && <p className="bio">{a.person.bio}</p>}
                  {a.person.reason && <p className="bio">Reason given: {a.person.reason}</p>}
                  {a.person.previous.length > 0 && (
                    <p className="prev">Earlier at {a.person.previous.join(", ")}</p>
                  )}
                  <a className="src" href={`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(a.person.person + " " + a.company)}`}
                    target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()}>
                    Profile taken from the filing. Look them up on LinkedIn
                  </a>
                </div>
              ) : (
                <>
                  <h3>{a.summary || tidy(a.headline)}</h3>
                  {a.summary && <p className="sub">{tidy(a.headline)}</p>}
                </>
              )}
              <p className="why">{e.why}{a.related?.length ? `. ${a.related.length} related filing${a.related.length > 1 ? "s" : ""} folded in` : ""}</p>
            </article>
          </Swipe>
        ))}
      </section>

      {t2.length > 0 && (
        <section>
          <h2>Worth a glance <small>{t2.length}</small></h2>
          <ul className="rows">
            {t2.map(({ a, e }) => (
              <li key={a.id}>
                <Swipe onBury={() => bury(a)}>
                  <button className="row" onClick={() => openSource(detail(a, e.why))}>
                    <span className="row-main">
                      <span className="co">{a.symbol}</span> {a.summary || tidy(a.headline)}
                    </span>
                    <span className="row-meta">{CATEGORY_LABEL[a.category]}, {ago(a.ts, asOf)}</span>
                  </button>
                </Swipe>
              </li>
            ))}
          </ul>
        </section>
      )}

      {buriedCount > 0 && (
        <section className="buried">
          <button className="buried-head" aria-expanded={showBuried} onClick={() => setShowBuried((v) => !v)}>
            <span>{buriedCount} buried</span>
            <span className="muted">{buriedKinds.slice(0, 3).map(([k, n]) => `${n} ${k.toLowerCase()}`).join(", ")}</span>
            <span className="chev">{showBuried ? "Hide" : "Show"}</span>
          </button>
          {showBuried && (
            <ul className="rows faint">
              {t3.map(({ a, e }) => (
                <li key={a.id}>
                  <button className="row" onClick={() => openSource(detail(a, e.why))}>
                    <span className="row-main"><span className="co">{a.symbol}</span> {tidy(a.headline)}</span>
                    <span className="row-meta">{e.why}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
