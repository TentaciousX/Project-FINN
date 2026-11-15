import { llmJson, type LlmOpts, type Part } from "./gemini";
import { downloadPdf, isScanned, readPdf, toBase64 } from "./pdf";
import { pct, revenueRow } from "./derive";
import { ALL_CATEGORIES } from "./classify";
import type { Announcement, Category, Fundamentals, PeriodFigures, PersonCard, ResultsCard, Tier } from "./types";

// ---------- Quarterly results: first cut straight from the filing ----------

const RESULTS_SYSTEM = `You read the statement of financial results inside an Indian company's exchange filing and copy out line items.
Copy numbers exactly as printed. Never estimate or compute. Use null when a line is not printed. Return JSON only.`;

const RESULTS_PROMPT = `From the statement of financial results, prefer the CONSOLIDATED statement; use standalone only if there is no consolidated one.
The statement has three quarterly columns: the quarter just ended, the preceding quarter, and the same quarter a year earlier.

Return this JSON:
{
  "basis": "Consolidated | Standalone",
  "unit": "crore | lakh | million | billion | thousand",
  "is_bank_or_lender": true or false,
  "columns": {
    "current":  { "label": "quarter end as printed, e.g. 30 Sep 2026", "revenue_from_operations": n, "other_income": n, "finance_costs": n, "depreciation": n, "profit_before_exceptional_and_tax": n, "profit_before_tax": n, "profit_after_tax": n },
    "previous": { same keys },
    "year_ago": { same keys }
  }
}
For a bank or lender, revenue_from_operations is total interest earned or total revenue from operations.
profit_after_tax is the net profit for the period (before other comprehensive income).`;

interface ResCol {
  label?: string; revenue_from_operations?: number | null; other_income?: number | null;
  finance_costs?: number | null; depreciation?: number | null;
  profit_before_exceptional_and_tax?: number | null; profit_before_tax?: number | null; profit_after_tax?: number | null;
}
interface ResOut {
  basis?: string; unit?: string; is_bank_or_lender?: boolean;
  columns?: { current?: ResCol; previous?: ResCol; year_ago?: ResCol };
}

const TO_CRORE: Record<string, number> = { crore: 1, lakh: 0.01, million: 0.1, billion: 100, thousand: 0.0001 };
const n = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

function toFigures(c: ResCol | undefined, k: number, lender: boolean): PeriodFigures | null {
  if (!c || n(c.revenue_from_operations) == null) return null;
  const pbtPre = n(c.profit_before_exceptional_and_tax) ?? n(c.profit_before_tax);
  const fin = n(c.finance_costs), dep = n(c.depreciation), oi = n(c.other_income) ?? 0;
  // EBITDA is not a printed line. Convention used: PBT before exceptionals
  // + finance costs + depreciation - other income. Not meaningful for lenders.
  const ebitda = lender || pbtPre == null || fin == null || dep == null ? null : pbtPre + fin + dep - oi;
  const r = (v: number | null) => (v == null ? null : Math.round(v * k * 10) / 10);
  return {
    label: String(c.label || "").trim(),
    revenue: r(n(c.revenue_from_operations)),
    ebitda: r(ebitda),
    pbt: r(n(c.profit_before_tax) ?? pbtPre),
    pat: r(n(c.profit_after_tax)),
  };
}

const RESULT_PAGE = /revenue from operations|interest earned|total income/i;
const RESULT_PAGE2 = /profit.{0,30}before.{0,20}tax|net profit/i;

export async function resultsFromFiling(url: string, f: Fundamentals | null, opts: LlmOpts = {}): Promise<ResultsCard> {
  const bytes = await downloadPdf(url);
  const doc = await readPdf(bytes);
  let parts: Part[];
  let naiveChars: number;
  // Pages that hold a results table, consolidated statements first. Many filings
  // put the standalone statement first, and some scan the tables as images.
  const hits = doc.pages
    .filter((p) => RESULT_PAGE.test(p) && RESULT_PAGE2.test(p))
    .map((p, i) => ({ p, i, c: (p.match(/consolidated/gi) || []).length > (p.match(/standalone/gi) || []).length ? 0 : 1 }))
    .sort((a, b) => a.c - b.c || a.i - b.i)
    .slice(0, 5)
    .map((x) => x.p);
  if (isScanned(doc) || !hits.length) {
    // No table in the text layer: let the model read the PDF itself.
    if (bytes.length > 14_000_000) throw new Error("Results table is scanned and the PDF is too large to send");
    parts = [{ inline_data: { mime_type: "application/pdf", data: toBase64(bytes) } }, { text: RESULTS_PROMPT }];
    naiveChars = doc.pages.length * 3000;
  } else {
    parts = [{ text: `${RESULTS_PROMPT}\n\nFILING PAGES\n${hits.map((p) => p.slice(0, 9000)).join("\n\n-----\n\n")}` }];
    naiveChars = doc.text.length;
  }
  let out = await llmJson<ResOut>("Read results filing", "cheap", RESULTS_SYSTEM, parts, { ...opts, naiveChars });
  const inline = "inline_data" in parts[0];
  if (f?.consolidated && /standalone/i.test(String(out.basis))) {
    // The text pages we picked were the standalone statement. Let the model look at the whole PDF once.
    if (inline || bytes.length > 14_000_000) throw new Error("only the standalone statement could be read");
    out = await llmJson<ResOut>(
      "Read results filing", "cheap", RESULTS_SYSTEM,
      [{ inline_data: { mime_type: "application/pdf", data: toBase64(bytes) } }, { text: `${RESULTS_PROMPT}\nThis filing contains a consolidated statement. Find it and use it.` }],
      { ...opts, naiveChars }
    );
    if (/standalone/i.test(String(out.basis))) throw new Error("only the standalone statement could be read");
  }
  const k = TO_CRORE[String(out.unit || "crore").toLowerCase()] ?? 1;
  const lender = Boolean(out.is_bank_or_lender) || Boolean(f?.isLender);
  const current = toFigures(out.columns?.current, k, lender);
  if (!current) throw new Error("The model could not find the current-quarter column");
  const basis = /standalone/i.test(String(out.basis)) ? "Standalone" : "Consolidated";
  let crossChecked: boolean | null = null;
  // Only comparable when the filing figures and the reference table are on the same basis.
  if (f && (basis === "Consolidated") === f.consolidated) {
    const s = revenueRow(f, f.quarters);
    const ref = s[s.length - 1];
    const d = pct(current.revenue, ref);
    crossChecked = d == null ? null : Math.abs(d) <= 2;
  }
  return {
    source: "filing",
    basis,
    unit: "Rs crore",
    isLender: lender,
    current,
    previous: toFigures(out.columns?.previous, k, lender),
    yearAgo: toFigures(out.columns?.year_ago, k, lender),
    crossChecked,
  };
}

// ---------- Management change: who is this person ----------

const PERSON_SYSTEM = `You read an Indian exchange filing about a director or senior executive joining or leaving.
Use only the filing text. These filings usually include a brief profile of an appointee; summarise that, do not invent one. Return JSON only.`;

const PERSON_PROMPT = `Return this JSON for the most senior person the filing is about:
{
  "person": "full name",
  "role": "the role, e.g. Chief Financial Officer",
  "change": "appointed | resigned | retired | reappointed | ceased",
  "effective": "date as printed, or null",
  "reason": "stated reason for leaving, 12 words or fewer, or null",
  "is_key_executive": true if CEO, MD, CFO, whole-time or executive director, or chairperson; false for independent directors, company secretary and others,
  "bio": "for an appointee: where they came from and what they have done, 40 words or fewer, from the filing's profile; null if the filing has none",
  "previous": ["up to 3 earlier employers or roles named in the filing"]
}`;

interface PersonOut {
  person?: string; role?: string; change?: string; effective?: string | null; reason?: string | null;
  is_key_executive?: boolean; bio?: string | null; previous?: string[];
}

export async function personFromFiling(a: { url: string | null; headline: string; body: string }, opts: LlmOpts = {}): Promise<PersonCard> {
  let parts: Part[];
  let naiveChars = a.body.length;
  const lead = `Subject: ${a.headline}\nExchange summary: ${a.body.slice(0, 1200)}`;
  let pdfText = "";
  let inline: Part | null = null;
  if (a.url) {
    try {
      const bytes = await downloadPdf(a.url);
      const doc = await readPdf(bytes);
      naiveChars = doc.text.length;
      if (isScanned(doc)) {
        if (bytes.length < 8_000_000) inline = { inline_data: { mime_type: "application/pdf", data: toBase64(bytes) } };
      } else pdfText = doc.pages.slice(0, 4).join("\n\n").slice(0, 10000);
    } catch {
      // Fall back to the exchange's own summary text.
    }
  }
  parts = inline ? [inline, { text: `${PERSON_PROMPT}\n\n${lead}` }] : [{ text: `${PERSON_PROMPT}\n\n${lead}\n\nFILING TEXT\n${pdfText || "(attachment unreadable)"}` }];
  const o = await llmJson<PersonOut>("Read management change", "cheap", PERSON_SYSTEM, parts, { ...opts, naiveChars });
  if (!o.person) throw new Error("No person found in the filing");
  return {
    person: o.person.trim(),
    role: (o.role || "").trim(),
    change: (o.change || "changed").trim(),
    effective: o.effective || null,
    reason: o.reason || null,
    isKMP: Boolean(o.is_key_executive),
    bio: o.bio || null,
    previous: (o.previous ?? []).slice(0, 3),
  };
}

// ---------- Everything else: one batch call for labels and one-liners ----------

const TRIAGE_SYSTEM = `You triage Indian stock-exchange filings for a busy investor. Use only the text given. Return JSON only.`;

interface TriageOut {
  items?: { id: string; category?: string; materiality?: number; summary?: string }[];
}

export async function triageBatch(
  items: Pick<Announcement, "id" | "company" | "headline" | "body" | "category">[],
  opts: LlmOpts = {}
): Promise<Map<string, { category: Category; tier: Tier | null; summary: string }>> {
  const result = new Map<string, { category: Category; tier: Tier | null; summary: string }>();
  for (let i = 0; i < items.length; i += 30) {
    const chunk = items.slice(i, i + 30);
    const prompt = `For each filing return {"id", "category", "materiality", "summary"} inside {"items": [...]}.
- category: one of ${ALL_CATEGORIES.join(", ")}
- materiality: 1 if it could move the stock, 2 if worth a glance, 3 if routine paperwork
- summary: one line, 16 words or fewer, saying what happened and the number that matters if one is given. No company name, no filler.

FILINGS
${chunk
  .map((a) => `id=${a.id} | ${a.company} | rule guess: ${a.category}\nsubject: ${a.headline}\ntext: ${a.body.slice(0, 500)}`)
  .join("\n\n")}`;
    const out = await llmJson<TriageOut>("Triage and one-liners", "cheap", TRIAGE_SYSTEM, [{ text: prompt }], opts);
    for (const it of out.items ?? []) {
      const cat = ALL_CATEGORIES.includes(it.category as Category) ? (it.category as Category) : "unclassified";
      const tier = it.materiality === 1 || it.materiality === 2 || it.materiality === 3 ? (it.materiality as Tier) : null;
      result.set(it.id, { category: cat, tier, summary: (it.summary || "").trim() });
    }
  }
  return result;
}
