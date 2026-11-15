import { llmJson, type LlmOpts } from "./gemini";
import { downloadPdf, isScanned, readPdf, toBase64 } from "./pdf";
import { numbersBrief } from "./derive";
import type { CallDigest, CallLanguage, Concall, Fundamentals, GuidanceThread, Ledger, Promise_, PromiseStatus } from "./types";

// The promise ledger.
//   1. For each of the last few earnings calls, the cheap model pulls out what
//      management explicitly promised, with the verbatim sentence.
//   2. Code checks every quote really appears in the transcript.
//   3. One strong-model call grades each promise against the reported numbers.

const CUE =
  /\b(guid\w*|expect\w*|target\w*|aim\w*|aspir\w*|outlook|going forward|next (year|quarter|few|two|three)|fy ?'?\d{2}|by (the )?end of|we will|we should|we are confident|confident of|capex|margins?|growth|double|maintain\w*|range of|trajectory|run.?rate|order ?book|capacity)\b/gi;

const FORWARD = /\b(guid\w*|expect\w*|target\w*|aim\w*|aspir\w*|outlook|going forward|next (year|quarter|fiscal|few|two|three)|fy ?'?\d{2}|by (the )?end of|we will|will be|we should|confident)\b/i;

// Page headers and footers repeat on every page and break quotes that span a page.
export function stripFurniture(text: string): string {
  const lines = text.split("\n");
  const count = new Map<string, number>();
  for (const l of lines) {
    const k = l.trim().replace(/\d+/g, "#");
    if (k.length > 3 && k.length < 90) count.set(k, (count.get(k) ?? 0) + 1);
  }
  return lines.filter((l) => (count.get(l.trim().replace(/\d+/g, "#")) ?? 0) < 6).join("\n");
}

// Keep only the speaker turns that look forward. Cuts tokens sent by half or more.
export function prefilter(text: string): { sent: string; filtered: boolean } {
  const cap = 140000;
  const re = /(?:^|\n)[ \t]*([A-Z][A-Za-z.'’\- ]{2,40}):[ \t]/g;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) starts.push(m.index);
  if (starts.length < 12) return { sent: text.slice(0, cap), filtered: false };
  const turns = starts.map((s, i) => text.slice(s, starts[i + 1] ?? text.length).trim());
  const keep = new Set<number>();
  let opening = 0;
  turns.forEach((t, i) => {
    if (opening < 3 && i < 12 && t.length > 700) {
      opening++;
      keep.add(i);
      return;
    }
    if (t.length < 160) return;
    const cues = (t.match(CUE) || []).length;
    if (cues >= 3 && FORWARD.test(t) && /\d/.test(t)) {
      keep.add(i);
      if (i > 0) keep.add(-i); // negative marks "previous turn, truncated"
    }
  });
  const out: string[] = [];
  turns.forEach((t, i) => {
    if (keep.has(i)) out.push(t);
    else if (keep.has(-(i + 1))) out.push(t.length > 260 ? t.slice(0, 260) + " [...]" : t);
  });
  const sent = out.join("\n\n");
  if (sent.length < 3000 || sent.length < text.length * 0.12) return { sent: text.slice(0, cap), filtered: false };
  return { sent: sent.slice(0, 70000), filtered: true };
}

const HEDGE = /\b(might|maybe|perhaps|hopefully|potentially|possibly|roughly|approximately|sort of|kind of|more or less|difficult to say|hard to say|we will see|let us see|let's see|cannot comment|can't comment|too early)\b/gi;
const CERTAIN = /\b(will|clearly|definitely|certainly|absolutely|committed|confident|guarantee\w*|undoubtedly|surely)\b/gi;
const SUPER = /\b(tremendous|fantastic|unprecedented|stellar|incredible|unbelievable|phenomenal|outstanding|extraordinary|remarkable|exceptional)\b/gi;
const count = (t: string, re: RegExp) => (t.match(re) || []).length;

// Plain word counts on management's own turns. Descriptive only: a higher hedge
// share under questioning than in the script is a prompt to read the Q&A, not a verdict.
export function languageStats(text: string): CallLanguage | undefined {
  const re = /(?:^|\n)[ \t]*([A-Z][A-Za-z.'’\- ]{2,40}):[ \t]/g;
  const marks: { at: number; who: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) marks.push({ at: m.index, who: m[1].trim().toLowerCase() });
  if (marks.length < 12) return undefined;
  const turns = marks.map((k, i) => ({ who: k.who, t: text.slice(k.at, marks[i + 1]?.at ?? text.length) }));
  // Q&A starts at the first moderator turn that announces questions.
  let qa = turns.findIndex((x, i) => i > 1 && /moderator|operator/.test(x.who) && /question/i.test(x.t));
  if (qa < 0) qa = Math.min(turns.length - 1, Math.max(3, Math.round(turns.length * 0.2)));
  // Management = whoever spoke at length before the Q&A began.
  const mgmt = new Set(turns.slice(0, qa).filter((x) => !/moderator|operator/.test(x.who) && x.t.length > 400).map((x) => x.who));
  if (!mgmt.size) return undefined;
  const prepared = turns.slice(0, qa).filter((x) => mgmt.has(x.who)).map((x) => x.t).join(" ");
  const answers = turns.slice(qa).filter((x) => mgmt.has(x.who)).map((x) => x.t).join(" ");
  const ratio = (t: string) => {
    const h = count(t, HEDGE), c = count(t, CERTAIN);
    return h + c >= 8 ? Math.round((h / (h + c)) * 1000) / 10 : null;
  };
  const words = (prepared + " " + answers).split(/\s+/).length;
  return {
    hedgePrepared: ratio(prepared),
    hedgeQA: ratio(answers),
    superlativesPer1k: Math.round((count(prepared + " " + answers, SUPER) / Math.max(words, 1)) * 10000) / 10,
    wordsQA: answers.split(/\s+/).length,
  };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function quoteAppears(quote: string, normText: string): boolean {
  const q = norm(quote);
  if (q.length < 20) return false;
  if (normText.includes(q)) return true;
  const w = q.split(" ");
  if (w.length < 8) return false;
  let hit = 0, total = 0;
  for (let i = 0; i + 6 <= w.length; i += 2) {
    total++;
    if (normText.includes(w.slice(i, i + 6).join(" "))) hit++;
  }
  return total > 0 && hit / total >= 0.7;
}

const EXTRACT_SYSTEM = `You read one earnings-call transcript of an Indian listed company and list what management explicitly promised about the future.
Use only the transcript. Never add outside knowledge about the company.
Return JSON only.`;

const extractPrompt = (name: string, period: string) => `Company: ${name}
Call held around: ${period}

Return this JSON:
{
  "quarter_discussed": "e.g. Q2 FY27",
  "tone": "management's tone in 12 words or fewer",
  "pressing": ["up to 3 topics analysts pushed on, 6 words or fewer each"],
  "promises": [
    {
      "metric": "revenue_growth | margin | profit | capex | debt | working_capital | capacity | volume | other",
      "statement": "what was promised, plain words, 20 words or fewer",
      "quote": "the sentence(s) from the transcript that say it, copied character for character, 45 words or fewer",
      "speaker": "name and role if stated",
      "target": "the number or range promised, e.g. '15-17% revenue growth'; empty if only directional",
      "horizon": "when it falls due, e.g. 'FY27', 'Q3 FY27', 'next 2-3 years'",
      "specificity": "numeric | directional"
    }
  ],
  "reported": [
    {
      "metric": "what was measured, e.g. 'mobile phone volumes', 'IT hardware revenue', 'capex spent', 'order book'",
      "value": "the figure with its unit, e.g. '9.2 million units', 'INR 1,450 crore'",
      "period": "the period it covers, e.g. 'Q2 FY27', 'H1 FY27', 'FY26'",
      "quote": "the sentence that states it, copied character for character, 30 words or fewer"
    }
  ]
}

Rules for promises:
- Only forward-looking statements made by management about numbers: revenue or volume growth, margins, profit, capex, debt, working capital, cash flow, capacity, segment revenue.
- Put company-level promises first (total revenue, EBITDA or PBDIT margin, profit, capex, debt, working capital, operating cash flow). These can be checked against reported accounts.
- Then at most 3 segment or operational promises, and only ones with a number and a due date within about a year.
- Skip multi-year aspirations, descriptions of the quarter just reported, vague optimism, and anything said only by an analyst.
- At most 7 promises. Fewer is fine. An empty list is fine.

Rules for reported:
- Actual figures management states for a period that has ended, for things a profit and loss statement does not show: segment revenues, volumes, capacity commissioned, order book, capex spent, working-capital days, store or customer counts.
- At most 8, the ones most likely to settle a promise made on an earlier call.
- Every quote must be copied exactly from the transcript.`;

interface ExtractOut {
  quarter_discussed?: string;
  tone?: string;
  pressing?: string[];
  reported?: { metric?: string; value?: string; period?: string; quote?: string }[];
  promises?: {
    metric?: string; statement?: string; quote?: string; speaker?: string;
    target?: string; horizon?: string; specificity?: string;
  }[];
}

export interface CallExtract {
  call: CallDigest;
  promises: Promise_[];
}

export async function extractCall(
  symbol: string,
  name: string,
  concall: Concall,
  opts: LlmOpts = {}
): Promise<CallExtract> {
  if (!concall.transcriptUrl) throw new Error(`No transcript link for ${concall.period}`);
  const bytes = await downloadPdf(concall.transcriptUrl);
  const doc = await readPdf(bytes);
  doc.text = stripFurniture(doc.text);
  const scanned = isScanned(doc);
  let parts;
  let charsSent: number;
  if (scanned) {
    if (bytes.length > 14_000_000) throw new Error("Transcript is a scanned PDF too large to read");
    parts = [{ inline_data: { mime_type: "application/pdf", data: toBase64(bytes) } }, { text: extractPrompt(name, concall.period) }];
    charsSent = doc.pages.length * 3000;
  } else {
    const { sent } = prefilter(doc.text);
    charsSent = sent.length;
    parts = [{ text: `${extractPrompt(name, concall.period)}\n\nTRANSCRIPT\n${sent}` }];
  }
  const out = await llmJson<ExtractOut>("Read earnings call", "cheap", EXTRACT_SYSTEM, parts, {
    ...opts,
    naiveChars: scanned ? charsSent : doc.text.length,
  });
  const normText = norm(doc.text);
  const tag = concall.period.replace(/\s+/g, "");
  const promises: Promise_[] = (out.promises ?? [])
    .filter((p) => p.statement && p.quote)
    .slice(0, 7)
    .map((p, i) => ({
      id: `${symbol}-${tag}-${i + 1}`,
      callPeriod: concall.period,
      callUrl: concall.transcriptUrl,
      metric: p.metric || "other",
      statement: String(p.statement).trim(),
      quote: String(p.quote).trim(),
      quoteVerified: !scanned && quoteAppears(String(p.quote), normText),
      speaker: (p.speaker || "Management").trim(),
      target: (p.target || "").trim(),
      horizon: (p.horizon || "").trim(),
      specificity: p.specificity === "numeric" ? "numeric" : "directional",
      status: "pending" as PromiseStatus,
      actual: null,
      verdict: null,
      settledIn: null,
    }));
  return {
    call: {
      period: concall.period,
      url: concall.transcriptUrl,
      quarterDiscussed: out.quarter_discussed || "",
      tone: out.tone || "",
      pressing: (out.pressing ?? []).slice(0, 3),
      charsRead: doc.text.length,
      charsSent,
      language: scanned ? undefined : languageStats(doc.text),
      reported: (out.reported ?? [])
        .filter((r) => r.metric && r.value)
        .slice(0, 8)
        .map((r) => ({
          metric: String(r.metric).trim(),
          value: String(r.value).trim(),
          period: String(r.period || "").trim(),
          quote: String(r.quote || "").trim(),
          verified: !scanned && quoteAppears(String(r.quote || ""), normText),
        })),
    },
    promises,
  };
}

const SYNTH_SYSTEM = `You are an equity analyst checking management's past promises against reported numbers for an Indian listed company.
Use only the NUMBERS and PROMISES given. Never use outside knowledge of the company, news, or broker views.
Be exact and unsentimental. Return JSON only.`;

interface SynthOut {
  grades?: {
    id: string; status?: string; actual?: string; verdict?: string; settled_in?: string | null; tracking?: string | null;
    target_low?: number | null; target_high?: number | null; actual_value?: number | null; unit?: string | null;
  }[];
  threads?: { metric?: string; ids?: string[]; moved?: string; note?: string }[];
  delivered_summary?: string;
  divergences?: { story?: string; numbers?: string; read?: string }[];
  bull?: string[];
  bear?: string[];
  business?: string;
}

const STATUSES: PromiseStatus[] = ["kept", "missed", "partial", "pending", "unverifiable"];

export async function synthesize(
  f: Fundamentals,
  calls: CallDigest[],
  promises: Promise_[],
  opts: LlmOpts = {}
): Promise<Ledger> {
  const today = new Date().toISOString().slice(0, 10);
  const prompt = `Company: ${f.name} (${f.symbol})
Today: ${today}
About (company's own description): ${f.about.slice(0, 600) || "not available"}

NUMBERS
${numbersBrief(f)}

CALLS
${calls.map((c) => `${c.period} (${c.quarterDiscussed}): tone "${c.tone}"; analysts pressed on ${c.pressing.join("; ") || "nothing notable"}`).join("\n")}

REPORTED BY MANAGEMENT ON LATER CALLS (operating figures not in the accounts; use them to settle promises about segments, volumes and capacity)
${calls.flatMap((c) => (c.reported ?? []).map((r) => `- ${c.period} call: ${r.metric} = ${r.value} (${r.period})`)).join("\n") || "none"}

PROMISES
${promises.map((p) => `[${p.id}] made on the ${p.callPeriod} call, due ${p.horizon || "unspecified"}: ${p.statement}${p.target ? ` (target: ${p.target})` : ""}`).join("\n") || "none found"}

Return this JSON:
{
  "grades": [
    {
      "id": "promise id",
      "status": "kept | missed | partial | pending | unverifiable",
      "actual": "the reported figure(s) you compared against, with the period, e.g. 'Revenue YoY 11.2% in Sep 2026'",
      "verdict": "one sentence, 18 words or fewer",
      "settled_in": "the quarterly column label that settled it, e.g. 'Sep 2026', or null",
      "tracking": "for pending promises only: ahead | in_line | behind, judged on the periods reported so far; null if nothing to judge by",
      "target_low": number or null, "target_high": number or null,
      "actual_value": number or null,
      "unit": "% | bps | Rs crore | days | units | null"
    }
  ],
  "threads": [
    {
      "metric": "plain label for the commitment, e.g. 'EBITDA margin' or 'FY27 revenue growth'",
      "ids": ["promise ids for this same commitment, oldest call first"],
      "moved": "lowered | raised | held",
      "note": "22 words or fewer: how the number changed from call to call, and what was finally reported if known"
    }
  ],
  "delivered_summary": "40 words or fewer: across the last four quarters, what was promised versus what was delivered",
  "divergences": [
    { "story": "what management says, 16 words or fewer", "numbers": "what the numbers show, 16 words or fewer", "read": "agree | diverge" }
  ],
  "bull": ["3 points, 18 words or fewer each, each tied to a number or a kept promise"],
  "bear": ["3 points, 18 words or fewer each, each tied to a number or a missed promise"],
  "business": "what the company does, 35 words or fewer, from the About text and calls only"
}

Grading rules:
- Grade every promise id exactly once.
- pending: the due date has not passed, or the period is not yet in NUMBERS.
- unverifiable: the metric is not in NUMBERS (for example volumes, store counts, order book). Do not guess.
- kept or missed: only when NUMBERS settle it. partial: direction right but short of the stated number.
- A full-year or standing target (for example "18-20% margin for FY27") is judged on the full year or year to date, never on one quarter. If the year is still running it is pending: set tracking, and give the year-to-date figure in "actual".
- A promise about a segment, volume or capacity can be settled by a figure in REPORTED BY MANAGEMENT for the due period; say "per management, <call> call" in "actual". Only use a figure that is for the same thing and the same period.
- A promise made on a call cannot be settled by numbers for a period that ended before that call.
- target_low, target_high, actual_value: plain numbers in the same unit, only when the promise is numeric and you used a specific reported figure. For a single target set both to it; for "above X" set only target_low; for "below X" set only target_high. Otherwise null.
- threads: only for a commitment that management gave on two or more calls. "lowered" means a later call gave a weaker number for the same period or goal. Never group different metrics or different periods. An empty list is fine.
- At most 4 divergences; include the ones that matter most.`;

  const out = await llmJson<SynthOut>("Grade promises", "strong", SYNTH_SYSTEM, [{ text: prompt }], {
    ...opts,
    maxOutputTokens: 12000,
  });
  const byId = new Map((out.grades ?? []).map((g) => [g.id, g]));
  const graded = promises.map((p) => {
    const g = byId.get(p.id);
    if (!g) return p;
    const status = STATUSES.includes(g.status as PromiseStatus) ? (g.status as PromiseStatus) : "pending";
    const tracking = status === "pending" && ["ahead", "in_line", "behind"].includes(String(g.tracking)) ? (g.tracking as Promise_["tracking"]) : null;
    const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
    return {
      ...p, status, actual: g.actual || null, verdict: g.verdict || null, settledIn: g.settled_in || null, tracking,
      targetLow: num(g.target_low), targetHigh: num(g.target_high), actualValue: num(g.actual_value), unit: g.unit && g.unit !== "null" ? g.unit : null,
    };
  });
  return {
    symbol: f.symbol,
    name: f.name,
    generatedAt: new Date().toISOString(),
    calls,
    promises: graded,
    deliveredSummary: out.delivered_summary || "",
    divergences: (out.divergences ?? [])
      .filter((d) => d.story && d.numbers)
      .slice(0, 4)
      .map((d) => ({ story: d.story!, numbers: d.numbers!, read: d.read === "agree" ? "agree" : "diverge" })),
    bull: (out.bull ?? []).slice(0, 3),
    bear: (out.bear ?? []).slice(0, 3),
    business: out.business || "",
    threads: (out.threads ?? [])
      .map((t) => ({
        metric: String(t.metric || "").trim(),
        ids: (t.ids ?? []).filter((id) => promises.some((p) => p.id === id)),
        moved: (["lowered", "raised", "held"].includes(String(t.moved)) ? t.moved : "held") as GuidanceThread["moved"],
        note: String(t.note || "").trim(),
      }))
      .filter((t) => t.metric && t.ids.length >= 2)
      .slice(0, 6),
  };
}

export const MAX_CALLS = 6;

export function callsToRead(f: Fundamentals): Concall[] {
  return f.concalls.filter((c) => c.transcriptUrl).slice(0, MAX_CALLS);
}

export async function buildLedger(f: Fundamentals, opts: LlmOpts = {}, log: (s: string) => void = () => {}): Promise<Ledger> {
  const calls: CallDigest[] = [];
  const promises: Promise_[] = [];
  for (const c of callsToRead(f)) {
    try {
      const r = await extractCall(f.symbol, f.name, c, opts);
      calls.push(r.call);
      promises.push(...r.promises);
      log(`    ${c.period}: ${r.promises.length} promises (${r.promises.filter((p) => p.quoteVerified).length} quotes verified)`);
    } catch (e) {
      log(`    ${c.period}: skipped, ${(e as Error).message}`);
    }
  }
  if (!calls.length) throw new Error(`No readable earnings-call transcripts for ${f.symbol}`);
  return synthesize(f, calls, promises, opts);
}

export function score(l: Ledger) {
  const c = { kept: 0, missed: 0, partial: 0, pending: 0, unverifiable: 0 };
  for (const p of l.promises) c[p.status]++;
  const settled = c.kept + c.missed + c.partial;
  return { ...c, settled, rate: settled ? (c.kept + 0.5 * c.partial) / settled : null };
}
