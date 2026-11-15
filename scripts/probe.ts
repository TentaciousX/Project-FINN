// One-minute health check of every data source, run from your own machine.
// Saves one raw sample of each into ./probe-out so parsers can be checked
// against the real thing. Nothing here writes your API key anywhere.
import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "./env";
import { getText, get } from "../lib/http";
import { fetchPrices } from "../lib/sources/yahoo";
import { fetchFundamentals } from "../lib/sources/screener";
import { fetchBse, fetchNse } from "../lib/sources/exchange";
import { candidates, listModels, llmJson, resolveModels } from "../lib/gemini";
import { downloadPdf, isScanned, readPdf } from "../lib/pdf";
import { prefilter, stripFurniture } from "../lib/ledger";
import { classify } from "../lib/classify";

loadEnv();
const OUT = path.join(process.cwd(), "probe-out");
fs.mkdirSync(OUT, { recursive: true });
const report: string[] = [];
const say = (s: string) => {
  console.log(s);
  report.push(s);
};
const save = (name: string, data: string) => fs.writeFileSync(path.join(OUT, name), data);

async function step(name: string, fn: () => Promise<string>) {
  const t = Date.now();
  try {
    const msg = await fn();
    say(`PASS  ${name}: ${msg} (${Date.now() - t} ms)`);
  } catch (e) {
    say(`FAIL  ${name}: ${(e as Error).message} (${Date.now() - t} ms)`);
  }
}

async function main() {
  const SYM = process.argv[2] || "DIXON";
  say(`FINN probe, ${new Date().toISOString()}, node ${process.version}, symbol ${SYM}`);
  const to = new Date();
  const from = new Date(Date.now() - 30 * 86400000);

  await step("Yahoo prices", async () => {
    const p = await fetchPrices(SYM);
    save("yahoo.json", JSON.stringify({ dates: p.dates.slice(-5), close: p.close.slice(-5), volume: p.volume.slice(-5) }));
    return `${p.dates.length} bars, last ${p.dates.at(-1)} close ${p.close.at(-1)}`;
  });

  let bseCode: string | null = null;
  let transcript: string | null = null;
  await step("Screener page", async () => {
    const html = await getText(`https://www.screener.in/company/${SYM}/consolidated/`, {
      headers: { Referer: "https://www.screener.in/" },
    });
    save("screener.html", html);
    const f = await fetchFundamentals(SYM);
    save("screener-parsed.json", JSON.stringify(f, null, 1));
    bseCode = f.bseCode;
    transcript = f.concalls.find((c) => c.transcriptUrl)?.transcriptUrl ?? null;
    return `${f.name}; quarters ${f.quarters.periods.length} cols x ${Object.keys(f.quarters.rows).length} rows; annual ${f.annual.periods.length}; balance ${f.balance.periods.length}; cashflow ${f.cashflow.periods.length}; ratios ${Object.keys(f.ratios).length}; concalls ${f.concalls.length} (${f.concalls.filter((c) => c.transcriptUrl).length} with transcript); annual reports ${f.annualReports.length}; BSE code ${f.bseCode}; lender ${f.isLender}`;
  });

  await step("NSE announcements", async () => {
    const rows = await fetchNse(SYM, from, to);
    save("nse.json", JSON.stringify(rows.slice(0, 40), null, 1));
    return `${rows.length} filings in 30 days; newest: ${rows[0]?.headline ?? "none"}`;
  });

  await step("BSE announcements", async () => {
    if (!bseCode) throw new Error("no BSE code from screener");
    const rows = await fetchBse(SYM, bseCode, from, to);
    save("bse.json", JSON.stringify(rows.slice(0, 40), null, 1));
    const tiers = [1, 2, 3].map((t) => rows.filter((r) => classify(r.headline, r.exchangeCategory, r.body).tier === t).length);
    return `${rows.length} filings in 30 days; rule tiers matter/glance/buried = ${tiers.join("/")}; newest: ${rows[0]?.headline ?? "none"}`;
  });

  await step("Transcript PDF", async () => {
    if (!transcript) throw new Error("no transcript link found on screener");
    const bytes = await downloadPdf(transcript);
    const doc = await readPdf(bytes);
    const pf = prefilter(stripFurniture(doc.text));
    save("transcript-head.txt", `${transcript}\n\n${doc.text.slice(0, 6000)}`);
    return `${(bytes.length / 1024).toFixed(0)} KB, ${doc.pages.length} pages, ${doc.text.length} chars, scanned=${isScanned(doc)}, prefilter keeps ${pf.sent.length} chars (filtered=${pf.filtered}); ${transcript}`;
  });

  const key = process.env.GEMINI_API_KEY;
  await step("Gemini key and models", async () => {
    if (!key) throw new Error("GEMINI_API_KEY missing: create .env.local from .env.example");
    const names = await listModels(key);
    save("gemini-models.json", JSON.stringify(names, null, 1));
    const m = await resolveModels(key);
    return `${names.length} models visible; cheap=${m.cheap}; strong=${m.strong}`;
  });
  if (key) {
    const tried = new Set<string>();
    for (const route of ["cheap", "strong"] as const) {
      for (const model of await candidates(key, route)) {
        if (tried.has(model)) continue;
        tried.add(model);
        await step(`Gemini ${route} candidate ${model}`, async () => {
          const out = await llmJson<{ ok: boolean }>("probe", route, "Return JSON only.", [{ text: 'Return {"ok": true}' }], {
            model, maxWaitMs: 20000, attemptMs: 20000,
          });
          return JSON.stringify(out);
        });
      }
    }
  }

  await step("NSE home (for reference)", async () => {
    const r = await get("https://www.nseindia.com/", { retries: 0, timeoutMs: 10000 });
    return `HTTP ${r.status}`;
  });

  save("report.txt", report.join("\n"));
  console.log(`\nSaved to ${OUT}. Send back report.txt, screener.html and bse.json or nse.json.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
