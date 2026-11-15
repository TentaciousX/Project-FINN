"use client";
import { useEffect, useMemo, useState } from "react";
import type { Announcement, PeriodFigures, ResultsCard, Snapshot } from "../lib/types";
import { CATEGORY_LABEL } from "../lib/classify";
import { pct } from "../lib/derive";
import { ago, effective, inr, moves, scan, signed, stamp, tidy, WINDOWS, type Alert, type Settings } from "../lib/client";
import { Stamp, Swipe, type SourceInfo } from "./ui";

interface Props {
  snap: Snapshot;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  openSource: (s: SourceInfo) => void;
  openCompany: (symbol: string) => void;
  bury: (a: Announcement) => void;
  alerts: Alert[];
  ackAlerts: () => void;
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

export default function Today({ snap, settings, update, openSource, openCompany, bury, alerts, ackAlerts }: Props) {
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

  // One tile per holding: the latest session's move, and whether anything needs reading.
  const tiles = useMemo(
    () =>
      snap.portfolio.map((h) => {
        const p = snap.prices[h.symbol];
        const k = p ? p.close.length - 1 : -1;
        const chg = p && k > 0 ? (p.close[k] / p.close[k - 1] - 1) * 100 : null;
        const m = mv.find((x) => x.symbol === h.symbol && p && x.date === p.dates[k]);
        return {
          symbol: h.symbol,
          pct: chg,
          heat: chg == null ? 0 : Math.min(1, Math.abs(chg) / 5),
          matters: t1.filter((x) => x.a.symbol === h.symbol).length,
          moved: Boolean(m),
          unexplained: Boolean(m && !m.explainedBy),
        };
      }),
    [snap, mv, t1]
  );

  // Everything below counts filings, not cards: a card can carry folded companions.
  const n = (list: { a: Announcement }[]) => list.reduce((k, x) => k + 1 + (x.a.related?.length ?? 0), 0);
  const f1 = n(t1), f2 = n(t2), f3 = n(t3);
  const sc = useMemo(() => scan(snap, settings, windowStart), [snap, settings, windowStart]);
  // Age is worked out after load, so the server-rendered page and the browser agree.
  const [ageH, setAgeH] = useState(0);
  useEffect(() => setAgeH(Math.round((Date.now() - asOf) / 3600000)), [asOf]);

  const [view, setView] = useState<"overview" | "filings" | "moves">("overview");
  const [moreMatters, setMoreMatters] = useState(false);
  const [moreGlance, setMoreGlance] = useState(false);
  const go = (v: typeof view) => {
    setView(v);
    window.scrollTo({ top: 0 });
  };

  // One line that says what a filing is about, for the short lists.
  const oneLine = (a: Announcement) => {
    if (a.results) {
      const r = a.results;
      return `Revenue ${signed(pct(r.current.revenue, r.yearAgo?.revenue ?? null))} on last year, profit ${signed(pct(r.current.pat, r.yearAgo?.pat ?? null))}`;
    }
    if (a.person) return `${a.person.person} ${a.person.change} as ${a.person.role}`;
    return a.summary || tidy(a.headline);
  };

  const card = ({ a, e }: { a: Announcement; e: { why: string } }) => (
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
            {a.person.previous.length > 0 && <p className="prev">Earlier at {a.person.previous.join(", ")}</p>}
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
  );

  // The overview never shows the same filing twice: what is in the alert strip is left out of the list.
  const alerted = new Set(alerts.slice(0, 2).map((al) => al.ann?.id));
  const topList = t1.filter((x) => !alerted.has(x.a.id)).slice(0, 4);
  const shownMatters = moreMatters ? t1 : t1.slice(0, 5);
  const shownGlance = moreGlance ? t2 : t2.slice(0, 6);

  return (
    <div className="page">
      <header className="lede">
        <p className="label">Filings that matter</p>
        <h1 className="figure">
          {t1.length}
          <span> of {total} filed</span>
        </h1>
        <div className="funnel" role="img" aria-label={`${f1} filings matter, ${f2} worth a glance, ${f3} buried`}>
          {f1 > 0 && <i className="a" style={{ flexGrow: f1 }} />}
          {f2 > 0 && <i className="b" style={{ flexGrow: f2 }} />}
          {f3 > 0 && <i className="c" style={{ flexGrow: f3 }} />}
        </div>
        <ul className="legend">
          <li><b className="a">{f1}</b>matter</li>
          <li><b className="b">{f2}</b>worth a glance</li>
          <li><b className="c">{f3}</b>buried</li>
        </ul>
        <p className={`fresh ${ageH > 24 ? "stale" : ""}`}>
          <i />
          {dayLabel(windowStart)} to {dayLabel(asOf)}. Snapshot taken {stamp(snap.generatedAt)}
          {ageH > 24 ? `, ${Math.round(ageH / 24)} day${ageH >= 48 ? "s" : ""} old. Re-run ingest for today's filings.` : ageH >= 1 ? `, ${ageH} h ago.` : "."}
        </p>
        <div className="seg" role="group" aria-label="Time window">
          {WINDOWS.filter((w) => w.hours <= snap.days * 24).map((w) => (
            <button key={w.hours} aria-pressed={settings.windowHours === w.hours} onClick={() => update({ windowHours: w.hours })}>
              {w.label}
            </button>
          ))}
        </div>
      </header>

      <nav className="jump views" aria-label="Views">
        <button aria-current={view === "overview" ? "true" : undefined} onClick={() => go("overview")}>Overview</button>
        <button aria-current={view === "filings" ? "true" : undefined} onClick={() => go("filings")}>Filings <b>{t1.length + t2.length}</b></button>
        <button aria-current={view === "moves" ? "true" : undefined} onClick={() => go("moves")}>Moves <b>{mv.length}</b></button>
      </nav>

      {view === "overview" && (
        <>
          {alerts.length > 0 && (
            <section className="alerts" aria-label="Alerts">
              <h2>
                {alerts.length} new since you last looked
                <button className="link" onClick={ackAlerts}>Mark read</button>
              </h2>
              {alerts.slice(0, 2).map((al) => (
                <button key={al.id} className="alert" onClick={() => (al.ann ? openSource(detail(al.ann, effective(al.ann, settings).why)) : openCompany(al.symbol))}>
                  <h3>{al.title}</h3>
                  <p className="why-care"><span>Why it matters</span>{al.why}</p>
                </button>
              ))}
              {alerts.length > 2 && <p className="hint">{alerts.length - 2} more are in Filings and Moves.</p>}
            </section>
          )}

          <section>
            <h2>Top of the list <small>{t1.length}</small></h2>
            {t1.length === 0 && (
              <p className="empty">
                Nothing material was filed in this window.
                {settings.windowHours < 168 && snap.days >= 7 && (
                  <button className="link" onClick={() => update({ windowHours: 168 })}>Widen to 7 days</button>
                )}
              </p>
            )}
            <ul className="rows">
              {topList.map(({ a, e }) => (
                <li key={a.id}>
                  <button className="row" onClick={() => openSource(detail(a, e.why))}>
                    <span className="row-main"><span className="co">{a.company}</span></span>
                    <span className="row-sub">{oneLine(a)}</span>
                    <span className="row-meta">{CATEGORY_LABEL[a.category]}, {ago(a.ts, asOf)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {t1.length + t2.length > 0 && (
              <button className="btn ghost full" onClick={() => go("filings")}>
                See all {t1.length} that matter{t2.length ? ` and ${t2.length} worth a glance` : ""}
              </button>
            )}
          </section>

          <section>
            <h2>Your holdings <small>last session</small></h2>
            <ul className="tiles">
              {tiles.map((t) => (
                <li key={t.symbol}>
                  <button className={t.pct == null ? "" : t.pct >= 0 ? "up" : "down"} style={{ ["--heat" as string]: t.heat }} onClick={() => openCompany(t.symbol)}>
                    <span className="t-sym">{t.symbol}</span>
                    <span className="t-pct">{signed(t.pct)}</span>
                    <span className="t-flag">{t.unexplained ? "unexplained" : t.matters ? `${t.matters} to read` : t.moved ? "explained" : ""}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="hint">Darker means a bigger move. Tap a holding for its ledger, numbers and filings.</p>
            {mv.length > 0 && (
              <button className="btn ghost full" onClick={() => go("moves")}>
                {sc.unexplained.length
                  ? `${sc.unexplained.length} unusual move${sc.unexplained.length > 1 ? "s" : ""} with no filing behind ${sc.unexplained.length > 1 ? "them" : "it"}`
                  : `${mv.length} unusual move${mv.length > 1 ? "s" : ""}, all explained`}
              </button>
            )}
          </section>
        </>
      )}

      {view === "filings" && (
        <>
          <section>
            <h2>Matters <small>{t1.length}</small></h2>
            {t1.length === 0 && <p className="empty">Nothing material was filed in this window.</p>}
            {shownMatters.map(card)}
            {t1.length > 5 && (
              <button className="btn ghost full" onClick={() => setMoreMatters((v) => !v)}>
                {moreMatters ? "Show fewer" : `Show ${t1.length - 5} more`}
              </button>
            )}
          </section>

          {t2.length > 0 && (
            <section>
              <h2>Worth a glance <small>{t2.length}</small></h2>
              <ul className="rows">
                {shownGlance.map(({ a, e }) => (
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
              {t2.length > 6 && (
                <button className="btn ghost full" onClick={() => setMoreGlance((v) => !v)}>
                  {moreGlance ? "Show fewer" : `Show ${t2.length - 6} more`}
                </button>
              )}
            </section>
          )}

          {buriedCount > 0 && (
            <section className="buried">
              <h2>Buried as routine <small>{buriedCount}</small></h2>
              <button className="buried-head" aria-expanded={showBuried} onClick={() => setShowBuried((v) => !v)}>
                <span className="muted">{buriedKinds.slice(0, 3).map(([k, c]) => `${c} ${k.toLowerCase()}`).join(", ")}</span>
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
        </>
      )}

      {view === "moves" && (
        <>
          <section>
            <h2>Unusual moves <small>{mv.length}</small></h2>
            <p className="hint">Beyond ±{settings.pricePct}% in a day, or volume over {settings.volMult}× its 20-day average. You set these in Rules.</p>
            {mv.length === 0 && <p className="empty">No holding crossed your thresholds in this window.</p>}
            <ul className="moves">
              {mv.map((m) => (
                <li key={m.symbol + m.date}>
                  <button onClick={() => (m.explainedBy ? openSource(detail(m.explainedBy, effective(m.explainedBy, settings).why)) : openCompany(m.symbol))}>
                    <span className="sym">{m.symbol}</span>
                    <span className={`delta ${m.pct >= 0 ? "up" : "down"}`}>{signed(m.pct)}</span>
                    <span className="vol">{m.volMult.toFixed(1)}× volume</span>
                    <span className={m.explainedBy ? "explained" : "unexplained"}>
                      {dayLabel(Date.parse(m.date + "T12:00:00+05:30"))}. {m.explainedBy ? `Explained: ${CATEGORY_LABEL[m.explainedBy.category].toLowerCase()}` : "No filing explains it"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2>Price against filings</h2>
            <ul className="facts">
              <li><b>{sc.explained.length}</b> unusual move{sc.explained.length === 1 ? "" : "s"} explained by a filing.</li>
              <li className={sc.unexplained.length ? "bad" : ""}><b>{sc.unexplained.length}</b> with no filing behind {sc.unexplained.length === 1 ? "it" : "them"}{sc.unexplained.length ? `: ${[...new Set(sc.unexplained.map((m) => m.symbol))].join(", ")}.` : "."}</li>
              <li><b>{sc.quiet.length}</b> material filing{sc.quiet.length === 1 ? "" : "s"} the price ignored (under 1% on the next session){sc.quiet.length ? `: ${[...new Set(sc.quiet.map((q) => q.a.symbol))].slice(0, 6).join(", ")}.` : "."} Either already priced in, or less material than ranked.</li>
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
