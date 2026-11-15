// Shared data contracts. The ingest script writes these shapes to /data,
// the API routes return them live, and the UI reads only these.

export type Category =
  | "results" | "M&A" | "fund_raise" | "management_change" | "litigation"
  | "insider_trading" | "earnings_call" | "investor_meetings" | "credit_rating"
  | "dividend" | "bonus_split" | "capex" | "press_release" | "postal_ballot"
  | "agm_egm" | "pledging" | "unclassified";

export type Tier = 1 | 2 | 3; // 1 matters, 2 worth a glance, 3 buried

export interface PeriodFigures {
  label: string;
  revenue: number | null;
  ebitda: number | null;
  pbt: number | null;
  pat: number | null;
}

export interface ResultsCard {
  source: "filing" | "screener";
  basis: string; // Consolidated / Standalone
  unit: string; // e.g. Rs crore
  isLender: boolean;
  current: PeriodFigures;
  previous: PeriodFigures | null;
  yearAgo: PeriodFigures | null;
  crossChecked: boolean | null; // filing revenue agrees with screener within 2%
  filingUrl?: string | null;
  // Promises from earlier calls that this quarter's numbers settled.
  settles?: { id: string; statement: string; status: PromiseStatus; verdict: string | null }[];
}

export interface PersonCard {
  person: string;
  role: string;
  change: string; // appointed, resigned, retired, reappointed, ceased
  effective: string | null;
  reason: string | null;
  isKMP: boolean;
  bio: string | null; // from the brief profile inside the filing itself
  previous: string[];
}

export interface Announcement {
  id: string;
  symbol: string;
  company: string;
  ts: string; // ISO with +05:30
  headline: string;
  body: string;
  exchangeCategory: string;
  url: string | null;
  source: "NSE" | "BSE";
  category: Category;
  tier: Tier;
  why: string; // why it ranked here, shown to the user
  classifiedBy: "rule" | "model";
  summary?: string;
  results?: ResultsCard;
  person?: PersonCard;
  related?: { id: string; headline: string; url: string | null }[];
}

export interface Table {
  periods: string[];
  rows: Record<string, (number | null)[]>;
}

export interface Concall {
  period: string; // screener label, e.g. "Oct 2026"
  transcriptUrl: string | null;
  pptUrl: string | null;
}

export interface Fundamentals {
  symbol: string;
  name: string;
  about: string;
  url: string;
  bseCode: string | null;
  isLender: boolean;
  consolidated: boolean;
  ratios: Record<string, string>;
  quarters: Table;
  annual: Table;
  balance: Table;
  cashflow: Table;
  ratiosTable: Table;
  concalls: Concall[];
  annualReports: { title: string; url: string }[];
  fetchedAt: string;
}

export type PromiseStatus = "kept" | "missed" | "partial" | "pending" | "unverifiable";

export interface Promise_ {
  id: string;
  callPeriod: string;
  callUrl: string | null;
  metric: string;
  statement: string;
  quote: string;
  quoteVerified: boolean;
  speaker: string;
  target: string;
  horizon: string;
  specificity: "numeric" | "directional";
  status: PromiseStatus;
  actual: string | null;
  verdict: string | null;
  settledIn: string | null;
  tracking?: "ahead" | "in_line" | "behind" | null; // for open promises
}

export interface CallDigest {
  period: string;
  url: string | null;
  quarterDiscussed: string;
  tone: string;
  pressing: string[];
  charsRead: number;
  charsSent: number;
  // Operating figures management stated on the call that never appear in a P&L
  // (segment revenue, volumes, capacity). Used to settle promises about them.
  reported?: { metric: string; value: string; period: string; quote: string; verified: boolean }[];
}

export interface Ledger {
  symbol: string;
  name: string;
  generatedAt: string;
  calls: CallDigest[];
  promises: Promise_[];
  deliveredSummary: string;
  divergences: { story: string; numbers: string; read: "agree" | "diverge" }[];
  bull: string[];
  bear: string[];
  business: string;
}

export interface UsageRow {
  ts: string;
  step: string;
  model: string;
  route: "cheap" | "strong";
  inTok: number;
  outTok: number;
  cached: boolean;
  naiveInTok?: number; // what the unfiltered input would have cost
}

export interface PriceSeries {
  dates: string[];
  close: number[];
  volume: number[];
}

export interface LedgerIndexRow {
  symbol: string;
  name: string;
  kept: number;
  missed: number;
  partial: number;
  pending: number;
  unverifiable: number;
  calls: number;
}

// The main snapshot is embedded in the page. Per-company fundamentals and
// ledgers are static files under /public/data, fetched when a company is opened.
export interface Snapshot {
  generatedAt: string;
  sample: boolean;
  days: number;
  portfolio: { symbol: string; sector: string; name: string }[];
  research: string[];
  prices: Record<string, PriceSeries>;
  announcements: Announcement[];
  ledgerIndex: LedgerIndexRow[];
  cachedFundamentals: string[];
  usage: UsageRow[];
  stats: {
    filings: number;
    byRule: number;
    byModel: number;
    cacheHits: number;
    sources: Record<string, number>;
    models: { cheap: string; strong: string } | null;
  };
}
