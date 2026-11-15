import snapshot from "../data/snapshot.json";
import type { Announcement, Snapshot } from "../lib/types";
import { loadShowcase, type Pick } from "../lib/showcase";
import { CATEGORY_LABEL } from "../lib/classify";
import { pct } from "../lib/derive";
import { signed, stamp, tidy } from "../lib/client";
import SymbolBox from "../components/SymbolBox";
import "./landing.css";

const snap = snapshot as unknown as Snapshot;

function line(a: Announcement): string {
  if (a.results) {
    const r = a.results;
    return `Revenue ${signed(pct(r.current.revenue, r.yearAgo?.revenue ?? null))} on last year, profit ${signed(pct(r.current.pat, r.yearAgo?.pat ?? null))}`;
  }
  if (a.person) return `${a.person.person} ${a.person.change} as ${a.person.role}`;
  return a.summary || tidy(a.headline);
}

function PromiseCard({ pick, kind }: { pick: Pick; kind: "missed" | "kept" }) {
  const { p } = pick;
  return (
    <article className={`lp-promise ${kind}`}>
      <header>
        <span className="lp-co">{pick.company}</span>
        <span className={`lp-tag ${kind}`}>{kind === "missed" ? "Missed" : "Kept"}</span>
      </header>
      <p className="lp-when">{p.speaker ? `${p.speaker}, ` : ""}{p.callPeriod} earnings call</p>
      <blockquote>&ldquo;{p.quote}&rdquo;</blockquote>
      <dl>
        <div>
          <dt>Then reported</dt>
          <dd>{p.actual}</dd>
        </div>
      </dl>
      <a href={`/app#ledger/${pick.symbol}`}>Open the full ledger for {pick.symbol}</a>
    </article>
  );
}

export default function Landing() {
  const s = loadShowcase(snap);
  const total = s.matter + s.glance + s.buried || 1;
  const w = (n: number) => `${Math.max(2, (n / total) * 100)}%`;
  const ready = snap.ledgerIndex.filter((r) => r.kept + r.missed + r.partial > 0).map((r) => r.symbol).slice(0, 4);
  const person = snap.announcements.find((a) => a.tier === 1 && a.person);
  const withCard = snap.announcements.filter((a) => a.results);
  const result = withCard.find((a) => a.results!.source === "filing" && (a.results!.settles?.length ?? 0) > 0) ?? withCard.find((a) => a.results!.source === "filing") ?? withCard[0];
  const day = (d: string) => new Date(d + "T12:00:00+05:30").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

  return (
    <div className="lp">
      <header className="lp-hero">
        <nav>
          <span className="lp-mark">FINN</span>
          <a href="/app">Open the app</a>
        </nav>
        <div className="lp-hero-grid">
          <div>
            <h1>
              {s.filings} filings in {s.days} days.
              <br />
              {s.matterCards} were worth your time.
            </h1>
            <p className="lp-sub">
              FINN reads every exchange filing across your holdings, buries the paperwork, and checks what management
              said on earnings calls against what the company later reported.
            </p>
            <a className="lp-cta" href="/app">Open today&rsquo;s brief</a>
            <p className="lp-note">No sign-up. Real filings for {s.holdings} NSE companies, as of {stamp(s.generatedAt)}.</p>
          </div>

          <div className="lp-phone" aria-label="Today's brief, from live data">
            <p className="lp-ph-label">Filings that matter</p>
            <p className="lp-ph-fig">{s.matterCards}<span> of {s.filings} filed</span></p>
            <div className="lp-ph-bar"><i style={{ width: w(s.matter) }} /><i style={{ width: w(s.glance) }} /></div>
            {s.cards.map((a) => (
              <a key={a.id} className="lp-ph-card" href="/app">
                <span className="lp-ph-co">{a.company}</span>
                <span className="lp-ph-tag">{CATEGORY_LABEL[a.category]}</span>
                <span className="lp-ph-line">{line(a)}</span>
              </a>
            ))}
            <p className="lp-ph-buried">{s.buried} buried as routine</p>
          </div>
        </div>

        <ul className="lp-proof">
          <li><b>{s.byRule} of {s.filings}</b> filings sorted by fixed rules, with no AI call</li>
          {s.promises > 0 && <li><b>{s.quotesVerified} of {s.promises}</b> management quotes matched word for word to the transcript</li>}
          {s.resultsTotal > 0 && <li><b>{s.resultsRead} of {s.resultsTotal}</b> results read from the company&rsquo;s own filing</li>}
        </ul>
      </header>

      {(s.missedPick || s.keptPick) && (
        <section className="lp-sec">
          <h2>They said it on the call. Then the numbers came in.</h2>
          <p className="lp-lead">
            FINN reads the last six earnings calls for a company and writes down what management promised. When the
            period closes, each promise gets a verdict, with the sentence they said and the figure they reported.
          </p>
          <div className="lp-pair">
            {s.missedPick && <PromiseCard pick={s.missedPick} kind="missed" />}
            {s.keptPick && <PromiseCard pick={s.keptPick} kind="kept" />}
          </div>
          <p className="lp-tally">
            Across {s.ledgers} companies, {s.settled} promises have come due: <b>{s.kept} kept</b>, <b>{s.missed} missed</b>.
            {s.walkedDown ? ` One target was reached only after it was lowered: ${s.walkedDown.company}, ${s.walkedDown.metric.toLowerCase()}.` : ""}
          </p>
        </section>
      )}

      <section className="lp-sec alt">
        <h2>Most of what companies file is paperwork.</h2>
        <p className="lp-lead">
          Trading-window notices, newspaper copies, share allotments to staff, schedules of investor meetings. FINN keeps
          them one tap away and out of your morning. Every ranking shows its reason, and you can overrule any of it.
        </p>
        <div className="lp-funnel" role="img" aria-label={`${s.matter} filings matter, ${s.glance} worth a glance, ${s.buried} buried`}>
          <i className="a" style={{ width: w(s.matter) }} />
          <i className="b" style={{ width: w(s.glance) }} />
          <i className="c" style={{ width: w(s.buried) }} />
        </div>
        <ul className="lp-legend">
          <li><b className="a">{s.matter}</b> behind the {s.matterCards} that matter</li>
          <li><b className="b">{s.glance}</b> worth a glance</li>
          <li><b className="c">{s.buried}</b> buried</li>
        </ul>
      </section>

      <section className="lp-sec">
        <h2>What reaches your phone</h2>
        <ul className="lp-rows">
          {result && (
            <li>
              <span>Results, minutes after they are filed</span>
              <b>{result.company}: {line(result).toLowerCase()}.</b>
              <em>Revenue, EBITDA, PBT and PAT against last quarter and last year, read from the filing.{result.results?.settles?.length ? ` This one also settled ${result.results.settles.length} earlier promises.` : ""}</em>
            </li>
          )}
          {person && (
            <li>
              <span>Who just took the job</span>
              <b>{person.company}: {line(person)}.</b>
              <em>{person.person?.bio || "With their background, taken from the profile in the filing."}</em>
            </li>
          )}
          {s.unexplained && (
            <li>
              <span>Moves nobody explained</span>
              <b>{s.unexplained.symbol} {signed(s.unexplained.pct)} on {s.unexplained.volMult.toFixed(1)}× its usual volume on {day(s.unexplained.date)}.</b>
              <em>Nothing material was filed. You set the thresholds; FINN checks every move against the filings.</em>
            </li>
          )}
        </ul>
      </section>

      <section className="lp-sec alt">
        <h2>Try it on a company you don&rsquo;t own</h2>
        <p className="lp-lead">Any NSE symbol. FINN reads six call transcripts while you watch, about a minute.</p>
        <SymbolBox examples={ready.length ? ready : snap.portfolio.slice(0, 3).map((p) => p.symbol)} />
      </section>

      <section className="lp-sec">
        <h2>Why you can lean on it</h2>
        <ul className="lp-why">
          <li><b>Primary sources only.</b> Exchange filings, call transcripts and reported accounts. No broker notes, no news.</li>
          <li><b>Quotes are checked.</b> If a sentence is not in the transcript word for word, FINN says so.</li>
          <li><b>Sums are done in code.</b> Growth rates, gaps to target and the forensic screens never pass through a language model.</li>
          <li><b>It says when it cannot tell.</b> A promise about a number the company does not report is marked as uncheckable, not guessed.</li>
        </ul>
        {s.calls > 0 && (
          <p className="lp-tally">
            Building this whole brief took {s.calls} model calls, about ₹{s.costInr < 10 ? s.costInr.toFixed(2) : s.costInr.toFixed(0)} at list price.
          </p>
        )}
        <a className="lp-cta dark" href="/app">Open today&rsquo;s brief</a>
      </section>

      <footer className="lp-foot">
        <p>FINN, a prototype for the ENAM AI Engineer build challenge. Data from BSE filings, screener.in and Yahoo Finance. A research aid, not investment advice.</p>
      </footer>
    </div>
  );
}
