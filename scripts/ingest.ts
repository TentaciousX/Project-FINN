// Builds the data snapshot the app ships with.
//   npm run ingest                 full run for the portfolio in config/portfolio.json
//   npm run ingest -- --days=45    wider filing window (default 30)
//   npm run ingest -- --no-llm     data only, zero model calls
//   npm run ingest -- --fresh      ignore cached fundamentals and ledgers
//   npm run ledger -- DIXON KAYNES only (re)build promise ledgers for these symbols
// Every step is cached on disk, so a run that hits a rate limit can simply be re-run.
import fs from "node:fs";
import path from "node:path";
import { loadEnv, readJson, writeJson } from "./env";
import { sleep } from "../lib/http";
import { fetchPrices } from "../lib/sources/yahoo";
import { fetchFundamentals } from "../lib/sources/screener";
import { fetchFilings, type RawFiling } from "../lib/sources/exchange";
import { classify } from "../lib/classify";
import { resolveModels, type LlmCache, type LlmOpts } from "../lib/gemini";
import { buildLedger, score } from "../lib/ledger";
import { personFromFiling, resultsFromFiling, triageBatch } from "../lib/enrich";
import { resultsFromTable } from "../lib/derive";
import type { Announcement, Fundamentals, Ledger, LedgerIndexRow, PriceSeries, Snapshot, UsageRow } from "../lib/types";

loadEnv();
const ROOT = process.cwd();
const DATA = path.join(ROOT, "data");
const PUB = path.join(ROOT, "public", "data");
const CACHE = path.join(DATA, "cache");
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string, d: string) => args.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? d;
const symbolsArg = args.filter((a) => !a.startsWith("--")).map((s) => s.toUpperCase());

const DAYS = parseInt(opt("days", "30"), 10);
const FRESH = flag("fresh");
const ONLY_LEDGER = flag("only-ledger");
const KEY = flag("no-llm") ? undefined : process.env.GEMINI_API_KEY;

const lines: string[] = [];
const log = (s: string) => {
  console.log(s);
  lines.push(s);
};

// ---- model cache and usage log ----
const usageFile = path.join(CACHE, "usage-log.json");
const usageLog: UsageRow[] = readJson<UsageRow[]>(usageFile) ?? [];
let cacheHits = 0;
const cache: LlmCache = {
  async get(k) {
    return readJson(path.join(CACHE, "llm", `${k}.json`));
  },
  async set(k, v) {
    writeJson(path.join(CACHE, "llm", `${k}.json`), v);
  },
};
const llm: LlmOpts = {
  key: KEY,
  cache,
  onUsage: (row) => {
    if (row.cached) cacheHits++;
    else {
      usageLog.push(row);
      writeJson(usageFile, usageLog);
    }
  },
};

async function fundamentalsFor(symbol: string): Promise<Fundamentals | null> {
  const file = path.join(PUB, "fundamentals", `${symbol}.json`);
  const have = readJson<Fundamentals>(file);
  if (have && !FRESH && Date.now() - Date.parse(have.fetchedAt) < 12 * 3600 * 1000) return have;
  try {
    const f = await fetchFundamentals(symbol);
    writeJson(file, f);
    await sleep(1200); // be polite to screener.in
    return f;
  } catch (e) {
    log(`  screener failed for ${symbol}: ${(e as Error).message}`);
    return have;
  }
}

async function ledgerFor(f: Fundamentals): Promise<Ledger | null> {
  const file = path.join(PUB, "ledger", `${f.symbol}.json`);
  const have = readJson<Ledger>(file);
  if (have && !FRESH) return have;
  if (!KEY) return have;
  try {
    log(`  building ledger for ${f.symbol} (${f.concalls.filter((c) => c.transcriptUrl).length} transcripts listed)`);
    const l = await buildLedger(f, llm, log);
    writeJson(file, l);
    const s = score(l);
    log(`    graded: ${s.kept} kept, ${s.missed} missed, ${s.partial} partial, ${s.pending} pending, ${s.unverifiable} unverifiable`);
    return l;
  } catch (e) {
    log(`  ledger failed for ${f.symbol}: ${(e as Error).message}`);
    return have;
  }
}

function indexRow(l: Ledger): LedgerIndexRow {
  const s = score(l);
  return { symbol: l.symbol, name: l.name, kept: s.kept, missed: s.missed, partial: s.partial, pending: s.pending, unverifiable: s.unverifiable, calls: l.calls.length };
}

// Related filings (the deck, the press release, the newspaper ad) fold under one head.
const FOLDABLE = new Set(["results", "dividend", "earnings_call", "fund_raise", "bonus_split", "credit_rating", "agm_egm", "postal_ballot", "investor_meetings"]);

// Related filings (the deck, the press release, the newspaper ad) fold under one head.
function cluster(items: Announcement[]): Announcement[] {
  const sorted = [...items].sort((a, b) => a.tier - b.tier || Number(Boolean(b.results)) - Number(Boolean(a.results)) || Date.parse(b.ts) - Date.parse(a.ts));
  const heads: Announcement[] = [];
  for (const a of sorted) {
    const head = heads.find(
      (h) =>
        h.symbol === a.symbol &&
        h.category === a.category &&
        h.tier <= 2 &&
        Math.abs(Date.parse(h.ts) - Date.parse(a.ts)) < 48 * 3600 * 1000 &&
        (FOLDABLE.has(a.category) || a.tier === 3 || h.headline === a.headline)
    );
    if (head && !a.results && !a.person) {
      (head.related ??= []).push({ id: a.id, headline: a.headline, url: a.url });
    } else heads.push(a);
  }
  return heads.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
}

async function main() {
  const cfg = readJson<{ portfolio: { symbol: string; sector: string }[]; research: string[] }>(path.join(ROOT, "config", "portfolio.json"));
  if (!cfg) throw new Error("config/portfolio.json is missing");
  log(`FINN ingest ${new Date().toISOString()} ${KEY ? "with Gemini" : "WITHOUT Gemini (no key or --no-llm)"}`);

  let models: { cheap: string; strong: string } | null = null;
  if (KEY) {
    models = await resolveModels(KEY);
    log(`models: cheap=${models.cheap} strong=${models.strong}`);
  }

  if (ONLY_LEDGER) {
    const snapFile = path.join(DATA, "snapshot.json");
    const snap = readJson<Snapshot>(snapFile);
    for (const s of symbolsArg.length ? symbolsArg : cfg.research) {
      const f = await fundamentalsFor(s);
      if (!f) continue;
      fs.rmSync(path.join(PUB, "ledger", `${s}.json`), { force: true });
      const l = await ledgerFor(f);
      if (l && snap) {
        snap.ledgerIndex = [...snap.ledgerIndex.filter((r) => r.symbol !== s), indexRow(l)];
        if (!snap.cachedFundamentals.includes(s)) snap.cachedFundamentals.push(s);
        if (!snap.research.includes(s) && !snap.portfolio.some((p) => p.symbol === s)) snap.research.push(s);
      }
    }
    if (snap) {
      snap.usage = usageLog;
      writeJson(snapFile, snap);
    }
    return;
  }

  // Clear the invented sample companies the repo ships with for UI development.
  for (const dir of ["fundamentals", "ledger"]) {
    const d = path.join(PUB, dir);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) if (/^SAMPLE[A-Z]\.json$/.test(f)) fs.rmSync(path.join(d, f));
  }

  // 1. Fundamentals (also gives us BSE codes and transcript links)
  log("\n[1/5] fundamentals from screener.in");
  const funds: Record<string, Fundamentals> = {};
  const all = [...new Set([...cfg.portfolio.map((p) => p.symbol), ...cfg.research])];
  for (const s of all) {
    const f = await fundamentalsFor(s);
    if (f) funds[s] = f;
    log(`  ${s}: ${f ? `${f.quarters.periods.length} quarters, ${f.concalls.filter((c) => c.transcriptUrl).length} transcripts, BSE ${f.bseCode}` : "MISSING"}`);
  }

  // 2. Prices
  log("\n[2/5] end-of-day prices from Yahoo Finance");
  const prices: Record<string, PriceSeries> = {};
  for (const p of cfg.portfolio) {
    try {
      prices[p.symbol] = await fetchPrices(p.symbol);
      log(`  ${p.symbol}: ${prices[p.symbol].dates.length} bars to ${prices[p.symbol].dates.at(-1)}`);
    } catch (e) {
      log(`  ${p.symbol}: FAILED ${(e as Error).message}`);
    }
    await sleep(250);
  }

  // 3. Filings, classified by rules
  log(`\n[3/5] exchange filings, last ${DAYS} days`);
  const to = new Date();
  const from = new Date(Date.now() - DAYS * 86400000);
  let items: Announcement[] = [];
  const sources: Record<string, number> = {};
  const unsure = new Set<string>();
  for (const p of cfg.portfolio) {
    const cacheFile = path.join(CACHE, "filings", `${p.symbol}.json`);
    let raw: RawFiling[] | null = null;
    try {
      raw = await fetchFilings(p.symbol, funds[p.symbol]?.bseCode ?? null, from, to, log);
      writeJson(cacheFile, raw);
      log(`  ${p.symbol}: ${raw.length} filings`);
    } catch (e) {
      // The exchange sometimes refuses one company in a run. Keep what we fetched last time rather than lose it.
      raw = readJson<RawFiling[]>(cacheFile);
      log(`  ${p.symbol}: fetch failed (${(e as Error).message.slice(0, 90)}); ${raw ? `using ${raw.length} filings saved earlier` : "nothing saved earlier"}`);
    }
    const seen = new Set<string>();
    for (const r of raw ?? []) {
      const k = `${r.headline}|${r.ts}`;
      if (seen.has(k) || Date.parse(r.ts) < from.getTime()) continue;
      seen.add(k);
      const c = classify(r.headline, r.exchangeCategory, r.body);
      if (!c.confident) unsure.add(r.id);
      sources[r.source] = (sources[r.source] ?? 0) + 1;
      items.push({ ...r, company: funds[p.symbol]?.name || r.company, category: c.category, tier: c.tier, why: c.why, classifiedBy: "rule" });
    }
    await sleep(600);
  }
  const filings = items.length;
  log(`  total ${filings}; rules placed ${filings - unsure.size}, unsure ${unsure.size}`);

  // 4. Promise ledgers for the research set
  log("\n[4/5] promise ledgers");
  const ledgers: Record<string, Ledger> = {};
  const wantLedger = flag("ledger-all") ? all : cfg.research;
  for (const s of all) {
    if (!funds[s]) continue;
    const l = wantLedger.includes(s) ? await ledgerFor(funds[s]) : readJson<Ledger>(path.join(PUB, "ledger", `${s}.json`));
    if (l) ledgers[s] = l;
  }
  log(`  ledgers available: ${Object.keys(ledgers).join(", ") || "none"}`);

  // 5. Enrichment: spend model calls only on what ranked high
  log("\n[5/5] enrichment");
  const newestFirst = [...items].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));

  // 5a. One batch: the model places what the rules could not, and writes one-liners
  //     for everything that ranked. Done first so a filing it labels as a
  //     management change still gets a person card below.
  if (KEY) {
    const batch = newestFirst
      .filter((a) => unsure.has(a.id) || (a.tier <= 2 && a.category !== "results" && a.category !== "management_change"))
      .slice(0, 150);
    if (batch.length) {
      try {
        const out = await triageBatch(batch, llm);
        for (const a of batch) {
          const t = out.get(a.id);
          if (!t) continue;
          if (unsure.has(a.id)) {
            a.category = t.category;
            a.tier = t.tier ?? 3;
            a.classifiedBy = "model";
            a.why = a.tier === 3 ? "Read by the model: routine" : "Read by the model: the subject line did not say what this was";
          }
          if (t.summary && a.tier <= 2) a.summary = t.summary;
        }
        log(`  triage: ${out.size} of ${batch.length} filings read in ${Math.ceil(batch.length / 30)} call(s)`);
      } catch (e) {
        log(`  triage failed: ${(e as Error).message}`);
      }
    }
  }

  // 5b. Results: one card per company, on the filing that actually carries the statement.
  const resultScore = (a: Announcement) => {
    const h = `${a.headline} ${a.body}`.toLowerCase();
    let sc = 0;
    if (/^result/i.test(a.exchangeCategory)) sc += 4;
    if (/financial results?|results? for the/.test(h)) sc += 3;
    if (/outcome of (the )?board meeting|board meeting outcome/.test(h)) sc += 2;
    if (a.tier === 1) sc += 1;
    if (/presentation|press release|media release|reference to|issued by|transcript|recording|newspaper/.test(h)) sc -= 6;
    return sc;
  };
  for (const p of cfg.portfolio) {
    const cands = newestFirst.filter((a) => a.symbol === p.symbol && a.category === "results" && a.tier <= 2 && a.url);
    const best = cands.map((a) => ({ a, sc: resultScore(a) })).sort((x, y) => y.sc - x.sc || Date.parse(y.a.ts) - Date.parse(x.a.ts))[0];
    if (!best || best.sc < 3) continue;
    const a = best.a;
    const f = funds[a.symbol] ?? null;
    let card = null;
    if (KEY && a.url) {
      try {
        card = await resultsFromFiling(a.url, f, llm);
        log(`  results ${a.symbol}: read from filing (${card.basis}, cross-check ${card.crossChecked})`);
      } catch (e) {
        log(`  results ${a.symbol}: ${(e as Error).message.slice(0, 110)}; using screener table`);
      }
    }
    if (!card && f) card = resultsFromTable(f);
    if (!card) continue;
    card.filingUrl = a.url;
    const l = ledgers[a.symbol];
    if (l) {
      const cur = (f?.quarters.periods.at(-1) || "").toLowerCase();
      card.settles = l.promises
        .filter((x) => x.settledIn && x.settledIn.toLowerCase() === cur && ["kept", "missed", "partial"].includes(x.status))
        .map((x) => ({ id: x.id, statement: x.statement, status: x.status, verdict: x.verdict }));
    }
    a.results = card;
    a.tier = 1;
    a.why = "Results filed: headline numbers read from the filing";
    // Any other results filing from this company is a companion to this one.
    for (const o of cands) {
      if (o !== a && o.tier === 1) {
        o.tier = 2;
        o.why = "Companion to the results filing";
      }
    }
  }

  // 5c. People: who is the person behind a management change.
  if (KEY) {
    let people = 0;
    for (const a of newestFirst) {
      if (a.category !== "management_change" || a.tier > 2 || people >= 16) continue;
      people++;
      try {
        const person = await personFromFiling(a, llm);
        a.person = person;
        if (/reappoint|re-appoint/i.test(person.change)) {
          a.tier = 2;
          a.why = "Reappointment; no change in who runs the company";
        } else if (person.isKMP) {
          a.tier = 1;
          a.why = "Change at the top of the company";
        } else if (a.tier === 1) {
          a.tier = 2;
          a.why = "Board change, not a key executive";
        }
        log(`  person ${a.symbol}: ${person.person}, ${person.role} (${person.change})`);
      } catch (e) {
        log(`  person ${a.symbol}: ${(e as Error).message.slice(0, 100)}`);
      }
    }
    // Companies often file the same change twice. Keep one card per person.
    const firstFor = new Map<string, Announcement>();
    const dupes = new Set<string>();
    for (const a of newestFirst) {
      if (!a.person) continue;
      const k = `${a.symbol}|${a.person.person.toLowerCase().replace(/^(mr|ms|mrs|dr|shri)\.? /, "").replace(/[^a-z]/g, "")}`;
      const head = firstFor.get(k);
      if (head) {
        (head.related ??= []).push({ id: a.id, headline: a.headline, url: a.url });
        if (a.tier < head.tier) {
          head.tier = a.tier;
          head.why = a.why;
        }
        dupes.add(a.id);
      } else firstFor.set(k, a);
    }
    items = items.filter((a) => !dupes.has(a.id));
  }

  items = cluster(items);
  if (KEY) {
    const used = (r: "cheap" | "strong") => [...usageLog].reverse().find((u) => u.route === r)?.model;
    const head = await resolveModels(KEY);
    models = { cheap: used("cheap") || head.cheap, strong: used("strong") || head.strong };
  }

  const snapshot: Snapshot = {
    generatedAt: new Date().toISOString(),
    sample: false,
    days: DAYS,
    portfolio: cfg.portfolio.map((p) => ({ ...p, name: funds[p.symbol]?.name || p.symbol })),
    research: cfg.research,
    prices,
    announcements: items,
    ledgerIndex: Object.values(ledgers).map(indexRow),
    cachedFundamentals: Object.keys(funds),
    usage: usageLog,
    stats: { filings, byRule: filings - unsure.size, byModel: unsure.size, cacheHits, sources, models },
  };
  writeJson(path.join(DATA, "snapshot.json"), snapshot);

  const t = [1, 2, 3].map((x) => items.filter((a) => a.tier === x).length);
  log(`\nDONE. ${filings} filings -> ${t[0]} matter, ${t[1]} worth a glance, ${t[2]} buried (after folding related filings).`);
  log(`prices ${Object.keys(prices).length}/${cfg.portfolio.length}, fundamentals ${Object.keys(funds).length}/${all.length}, ledgers ${Object.keys(ledgers).length}.`);
  log(`model calls this run: ${usageLog.length} logged in total, ${cacheHits} served from cache.`);
  fs.writeFileSync(path.join(DATA, "ingest-report.txt"), lines.join("\n"));
  log("Report saved to data/ingest-report.txt");
}

main().catch((e) => {
  console.error("INGEST FAILED:", e);
  fs.writeFileSync(path.join(DATA, "ingest-report.txt"), lines.join("\n") + `\nFAILED: ${e?.stack || e}`);
  process.exit(1);
});
