// Writes an obviously fictional data set so the UI can be developed without
// network access. Company names are invented and the app shows a banner while
// this is loaded. `npm run ingest` replaces it with real data.
import path from "node:path";
import { writeJson } from "./env";
import { classify } from "../lib/classify";
import { score } from "../lib/ledger";
import type { Announcement, Fundamentals, Ledger, PriceSeries, Snapshot, Table } from "../lib/types";

const ROOT = process.cwd();
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

const cos = [
  ["SAMPLEA", "Sample Electronics Ltd", "Electronics manufacturing"],
  ["SAMPLEB", "Sample Paints Ltd", "Paints"],
  ["SAMPLEC", "Sample Bank Ltd", "Bank"],
  ["SAMPLED", "Sample Pharma Ltd", "Pharma"],
  ["SAMPLEE", "Sample Airlines Ltd", "Airline"],
  ["SAMPLEF", "Sample Software Ltd", "IT services"],
];
const now = new Date("2026-11-15T09:00:00+05:30").getTime();
const iso = (ms: number) => new Date(ms + 5.5 * 3600000).toISOString().slice(0, 19) + "+05:30";

function series(spikeAt: number | null, jump: number): PriceSeries {
  const out: PriceSeries = { dates: [], close: [], volume: [] };
  let p = 400 + rnd() * 3000;
  const base = 200000 + rnd() * 900000;
  let d = now - 180 * 86400000;
  while (d < now) {
    const day = new Date(d).getUTCDay();
    if (day !== 0 && day !== 6) {
      p *= 1 + (rnd() - 0.48) * 0.025;
      out.dates.push(new Date(d).toISOString().slice(0, 10));
      out.close.push(Math.round(p * 100) / 100);
      out.volume.push(Math.round(base * (0.6 + rnd() * 0.8)));
    }
    d += 86400000;
  }
  if (spikeAt != null) {
    const i = out.close.length - 1 - spikeAt;
    out.close[i] = Math.round(out.close[i - 1] * (1 + jump) * 100) / 100;
    for (let j = i + 1; j < out.close.length; j++) out.close[j] = Math.round(out.close[j - 1] * (1 + (rnd() - 0.5) * 0.01) * 100) / 100;
    out.volume[i] = Math.round(base * 3.4);
  }
  return out;
}

const qp = ["Sep 2024", "Dec 2024", "Mar 2025", "Jun 2025", "Sep 2025", "Dec 2025", "Mar 2026", "Jun 2026", "Sep 2026"];
function table(periods: string[], rows: Record<string, number[]>): Table {
  return { periods, rows };
}
function fund(symbol: string, name: string, lender: boolean): Fundamentals {
  const g = (start: number, step: number, n: number) => Array.from({ length: n }, (_, i) => Math.round(start * Math.pow(1 + step, i) * (0.97 + rnd() * 0.06)));
  const sales = g(2400, 0.06, 9);
  const op = sales.map((s) => Math.round(s * (lender ? 0.32 : 0.11 - 0.002 * rnd())));
  const pbt = op.map((o) => Math.round(o * 0.78));
  const np = pbt.map((o) => Math.round(o * 0.75));
  const years = ["Mar 2021", "Mar 2022", "Mar 2023", "Mar 2024", "Mar 2025", "Mar 2026"];
  const as = g(5200, 0.24, 6);
  const an = as.map((s) => Math.round(s * 0.055));
  return {
    symbol, name, about: `${name} is an invented company used as placeholder data.`,
    url: "https://www.screener.in/", bseCode: "000000", isLender: lender, consolidated: true,
    ratios: { "Market Cap": "₹ 41,200 Cr.", "Stock P/E": "58.2", ROCE: "24.1 %", ROE: "19.8 %" },
    quarters: table(qp, lender
      ? { Revenue: sales, "Financing Profit": op, "Financing Margin %": op.map((o, i) => Math.round((o / sales[i]) * 100)), "Profit before tax": pbt, "Net Profit": np }
      : { Sales: sales, "Operating Profit": op, "OPM %": op.map((o, i) => Math.round((o / sales[i]) * 1000) / 10), "Profit before tax": pbt, "Net Profit": np }),
    annual: table([...years, "TTM"], {
      [lender ? "Revenue" : "Sales"]: [...as, sales.slice(-4).reduce((a, b) => a + b, 0)],
      "Operating Profit": [...as.map((s) => Math.round(s * 0.1)), op.slice(-4).reduce((a, b) => a + b, 0)],
      "OPM %": [9.2, 9.6, 10.1, 10.4, 10.8, 10.6, 10.5],
      "Net Profit": [...an, np.slice(-4).reduce((a, b) => a + b, 0)],
    }),
    balance: table(years, { "Equity Capital": [60, 60, 60, 60, 60, 60], Reserves: [900, 1150, 1500, 1950, 2500, 3200], Borrowings: [420, 510, 640, 700, 980, 1420] }),
    cashflow: table(years, {
      "Cash from Operating Activity": an.map((v, i) => Math.round(v * [0.9, 1.1, 0.7, 0.85, 0.6, 0.55][i])),
      "Cash from Investing Activity": an.map((v) => -Math.round(v * 0.8)),
    }),
    ratiosTable: table(years, { "Debtor Days": [38, 41, 44, 49, 55, 61], "Cash Conversion Cycle": [12, 14, 19, 24, 31, 38], "ROCE %": [21, 22, 24, 25, 24, 24] }),
    concalls: [
      { period: "Oct 2026", transcriptUrl: "https://example.com/t5.pdf", pptUrl: null },
      { period: "Jul 2026", transcriptUrl: "https://example.com/t4.pdf", pptUrl: null },
    ],
    annualReports: [{ title: "Financial Year 2026", url: "https://example.com/ar.pdf" }],
    fetchedAt: new Date(now).toISOString(),
  };
}

const fa = fund("SAMPLEA", "Sample Electronics Ltd", false);
const fc = fund("SAMPLEC", "Sample Bank Ltd", true);

const mk = (id: string, callPeriod: string, metric: string, statement: string, quote: string, target: string, horizon: string, status: Ledger["promises"][number]["status"], actual: string | null, verdict: string | null, settledIn: string | null, verified = true) => ({
  id, callPeriod, callUrl: "https://example.com/t.pdf", metric, statement, quote, quoteVerified: verified,
  speaker: "A. Placeholder, Managing Director", target, horizon, specificity: (target ? "numeric" : "directional") as "numeric" | "directional",
  status, actual, verdict, settledIn,
});
const ledger: Ledger = {
  symbol: "SAMPLEA", name: "Sample Electronics Ltd", generatedAt: new Date(now).toISOString(),
  calls: [
    { period: "Oct 2026", url: "https://example.com/t5.pdf", quarterDiscussed: "Q2 FY27", tone: "Confident on demand, defensive on margins", pressing: ["Margin dilution", "Receivable days", "Capex funding"], charsRead: 88000, charsSent: 31000 },
    { period: "Jul 2026", url: "https://example.com/t4.pdf", quarterDiscussed: "Q1 FY27", tone: "Upbeat, leaning on order book", pressing: ["Customer concentration", "Working capital"], charsRead: 92000, charsSent: 35000 },
    { period: "Apr 2026", url: "https://example.com/t3.pdf", quarterDiscussed: "Q4 FY26", tone: "Measured after a soft quarter", pressing: ["FY27 growth guidance"], charsRead: 79000, charsSent: 28000 },
  ],
  promises: [
    mk("SAMPLEA-Apr2026-1", "Apr 2026", "revenue_growth", "Revenue to grow 25 to 30 percent in FY27", "we are looking at a growth of 25% to 30% on the top line for the coming financial year", "25-30% revenue growth", "FY27", "pending", "H1 FY27 revenue up 27.4% YoY", "Tracking inside the range at the halfway mark.", null),
    mk("SAMPLEA-Apr2026-2", "Apr 2026", "margin", "EBITDA margin to hold above 11 percent through FY27", "margins should sustain north of 11% for the full year", "EBITDA margin above 11%", "FY27", "missed", "EBITDA margin 10.4% in Jun 2026 and 10.6% in Sep 2026", "Two straight quarters below the floor management set.", "Sep 2026"),
    mk("SAMPLEA-Jul2026-1", "Jul 2026", "revenue_growth", "Second quarter revenue to grow faster than the first", "Q2 will be sequentially stronger than Q1 on the back of new programme ramp-ups", "", "Q2 FY27", "kept", "Revenue QoQ +6.8% in Sep 2026", "Sequential growth delivered as promised.", "Sep 2026"),
    mk("SAMPLEA-Jul2026-2", "Jul 2026", "working_capital", "Receivable days to come down by year end", "we expect debtor days to normalise by March", "", "Mar 2027", "pending", null, "Due at year end; debtor days have risen every year so far.", null),
    mk("SAMPLEA-Jul2026-3", "Jul 2026", "capex", "Capex of about 600 crore in FY27", "our capex outlay for this year will be in the range of 600 crores", "Rs 600 crore capex", "FY27", "pending", null, "Not due until the annual numbers.", null, false),
    mk("SAMPLEA-Oct2026-1", "Oct 2026", "volume", "Mobile volumes to double within two years", "we see our smartphone volumes doubling over the next two years", "2x volumes", "FY29", "unverifiable", null, "Volumes are not in the reported tables.", null),
    mk("SAMPLEA-Apr2026-3", "Apr 2026", "profit", "First-quarter profit growth above 20 percent", "we are fairly confident of north of 20% growth in PAT in the first quarter", "PAT growth above 20%", "Q1 FY27", "partial", "Net profit YoY +16.9% in Jun 2026", "Profit grew, but short of the number given.", "Jun 2026"),
  ],
  deliveredSummary: "Growth promises have largely been met; margin promises have not. Revenue is inside the guided range while EBITDA margin has sat below the 11 percent floor for two quarters.",
  divergences: [
    { story: "Margins are stable and will stay above 11 percent", numbers: "EBITDA margin fell from 10.8 to 10.4 to 10.6 percent", read: "diverge" },
    { story: "Working capital is under control", numbers: "Cash conversion cycle lengthened from 12 to 38 days in five years", read: "diverge" },
    { story: "Demand is strong across customers", numbers: "Revenue up 27 percent YoY in the first half", read: "agree" },
  ],
  bull: ["Revenue compounding above 20 percent with FY27 guidance on track", "Sequential growth promises kept two quarters running", "ROCE steady near 24 percent through heavy capex"],
  bear: ["Margin floor missed in both quarters since it was promised", "Operating cash was 55 percent of profit last year", "Borrowings up from 700 to 1,420 crore in two years"],
  business: "Contract manufacturer of consumer electronics for global and Indian brands. Placeholder description.",
};

const filings: [string, number, string, string, string][] = [
  ["SAMPLEA", 5, "Outcome of Board Meeting - Unaudited Financial Results for the quarter ended September 30, 2026", "Outcome of Board Meeting", "The Board approved the unaudited standalone and consolidated financial results."],
  ["SAMPLEA", 5.5, "Investor Presentation - Financial Results Q2 FY27", "Investor Presentation", ""],
  ["SAMPLEA", 7, "Newspaper Publication of Financial Results", "Newspaper Publication", ""],
  ["SAMPLEB", 9, "Appointment of Chief Financial Officer", "Change in Directorate", "Appointment of Ms. P. Placeholder as Chief Financial Officer and Key Managerial Personnel."],
  ["SAMPLED", 14, "Receipt of order from US FDA - warning letter for the Unit II facility", "Updates", "The company has received a warning letter and will respond within the stipulated time."],
  ["SAMPLEE", 20, "Disclosure of encumbrance of shares by promoter under Regulation 31", "Reg. 31", "Creation of pledge on 1.2% of paid-up capital."],
  ["SAMPLEF", 21, "Bags multi-year contract from a European insurer", "Press Release", "Total contract value of USD 120 million over five years."],
  ["SAMPLEC", 26, "Allotment of equity shares under ESOP scheme", "ESOP", ""],
  ["SAMPLEC", 28, "Analysts/Institutional Investor Meet - Schedule", "Analyst Meet", ""],
  ["SAMPLEB", 30, "Declaration of interim dividend of Rs 5 per share", "Dividend", "Record date 24 November 2026."],
  ["SAMPLED", 33, "Credit rating reaffirmed", "Credit Rating", "Rating reaffirmed at AA+ with stable outlook."],
  ["SAMPLEF", 40, "Certificate under Regulation 74(5)", "Compliance", ""],
  ["SAMPLEE", 44, "Closure of trading window", "Trading Window", ""],
  ["SAMPLEA", 52, "Transcript of earnings call for Q2 FY27", "Earnings Call Transcript", ""],
  ["SAMPLEC", 60, "Notice of Postal Ballot", "Postal Ballot", ""],
  ["SAMPLEF", 70, "General updates", "Updates", "Opening of a new delivery centre in Pune with capacity of 1,200 seats."],
  ["SAMPLED", 96, "Approval for capacity expansion at Unit IV", "Capex", "Capital expenditure of Rs 450 crore, to be commissioned by Q2 FY28."],
  ["SAMPLEB", 130, "Schedule of investor conference", "Analyst Meet", ""],
];
const name = (s: string) => cos.find((c) => c[0] === s)![1];
const anns: Announcement[] = filings.map(([symbol, hoursAgo, headline, cat, body], i) => {
  const c = classify(headline, cat, body);
  return {
    id: `S-${i}`, symbol, company: name(symbol), ts: iso(now - hoursAgo * 3600000), headline, body,
    exchangeCategory: cat, url: "https://example.com/filing.pdf", source: "BSE",
    category: c.category, tier: c.tier, why: c.why, classifiedBy: c.confident ? "rule" : "model",
  };
});
const res = anns[0];
res.results = {
  source: "filing", basis: "Consolidated", unit: "Rs crore", isLender: false, crossChecked: true, filingUrl: res.url,
  current: { label: "30 Sep 2026", revenue: 3812.4, ebitda: 404.1, pbt: 315.2, pat: 236.4 },
  previous: { label: "30 Jun 2026", revenue: 3569.7, ebitda: 371.2, pbt: 288.9, pat: 216.7 },
  yearAgo: { label: "30 Sep 2025", revenue: 2992.5, ebitda: 323.2, pbt: 251.6, pat: 188.7 },
  settles: ledger.promises.filter((p) => p.settledIn === "Sep 2026").map((p) => ({ id: p.id, statement: p.statement, status: p.status, verdict: p.verdict })),
};
res.related = [{ id: anns[1].id, headline: anns[1].headline, url: anns[1].url }, { id: anns[2].id, headline: anns[2].headline, url: anns[2].url }];
anns[3].person = {
  person: "P. Placeholder", role: "Chief Financial Officer", change: "appointed", effective: "1 December 2026", reason: null, isKMP: true,
  bio: "Chartered accountant with 22 years in finance. Was group financial controller at an invented conglomerate and earlier led treasury at an invented bank.",
  previous: ["Invented Conglomerate Ltd", "Invented Bank Ltd"],
};
anns[4].summary = "US FDA warning letter for Unit II; response due within the stipulated time.";
anns[4].tier = 1; anns[4].category = "litigation"; anns[4].why = "Read by the model: the subject line did not say what this was"; anns[4].classifiedBy = "model";
anns[6].summary = "Five-year, USD 120 million contract from a European insurer.";
anns[9].summary = "Interim dividend of Rs 5 a share; record date 24 November.";
anns[15].summary = "New 1,200-seat delivery centre opened in Pune."; anns[15].tier = 2; anns[15].category = "press_release"; anns[15].classifiedBy = "model";
anns[16].summary = "Rs 450 crore expansion at Unit IV, commissioning by Q2 FY28.";

const s = score(ledger);
const snapshot: Snapshot = {
  generatedAt: new Date(now).toISOString(),
  sample: true,
  days: 30,
  portfolio: cos.map(([symbol, n, sector]) => ({ symbol, name: n, sector })),
  research: ["SAMPLEA"],
  prices: Object.fromEntries(cos.map(([sym], i) => [sym, series(i === 0 ? 3 : i === 4 ? 0 : i === 5 ? 1 : null, i === 0 ? 0.071 : i === 4 ? -0.058 : 0.012)])),
  announcements: anns.filter((a) => a.id !== "S-1" && a.id !== "S-2"),
  ledgerIndex: [{ symbol: "SAMPLEA", name: ledger.name, kept: s.kept, missed: s.missed, partial: s.partial, pending: s.pending, unverifiable: s.unverifiable, calls: 3 }],
  cachedFundamentals: ["SAMPLEA", "SAMPLEC"],
  usage: [
    ...[0, 1, 2].map((i) => ({ ts: iso(now), step: "Read earnings call", model: "flash-lite", route: "cheap" as const, inTok: 8200 + i * 300, outTok: 900, cached: false, naiveInTok: 22000 })),
    { ts: iso(now), step: "Grade promises", model: "flash", route: "strong", inTok: 2600, outTok: 1400, cached: false },
    { ts: iso(now), step: "Read results filing", model: "flash-lite", route: "cheap", inTok: 3100, outTok: 420, cached: false, naiveInTok: 41000 },
    { ts: iso(now), step: "Read management change", model: "flash-lite", route: "cheap", inTok: 1900, outTok: 210, cached: false, naiveInTok: 2400 },
    { ts: iso(now), step: "Triage and one-liners", model: "flash-lite", route: "cheap", inTok: 2400, outTok: 600, cached: false },
  ],
  stats: { filings: 18, byRule: 16, byModel: 2, cacheHits: 0, sources: { BSE: 18 }, models: { cheap: "flash-lite", strong: "flash" } },
};

writeJson(path.join(ROOT, "data", "snapshot.json"), snapshot);
writeJson(path.join(ROOT, "public", "data", "fundamentals", "SAMPLEA.json"), fa);
writeJson(path.join(ROOT, "public", "data", "fundamentals", "SAMPLEC.json"), fc);
writeJson(path.join(ROOT, "public", "data", "ledger", "SAMPLEA.json"), ledger);
console.log("Sample snapshot written (fictional companies).");
