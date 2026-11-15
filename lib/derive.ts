import type { Fundamentals, PeriodFigures, ResultsCard, Table } from "./types";

// Pure arithmetic over the standardised tables. No model involved, so every
// number here is reproducible and free.

export function row(t: Table, ...labels: string[]): (number | null)[] {
  for (const l of labels) {
    if (t.rows[l]) return t.rows[l];
    const k = Object.keys(t.rows).find((x) => x.toLowerCase() === l.toLowerCase());
    if (k) return t.rows[k];
  }
  return [];
}

export const last = <T,>(a: T[], back = 0): T | undefined => a[a.length - 1 - back];

export function pct(now: number | null | undefined, then: number | null | undefined): number | null {
  if (now == null || then == null || then === 0) return null;
  return ((now - then) / Math.abs(then)) * 100;
}

export const revenueRow = (f: Fundamentals, t: Table) => row(t, "Sales", "Revenue");
export const opRow = (f: Fundamentals, t: Table) => row(t, "Operating Profit", "Financing Profit");
export const marginRow = (f: Fundamentals, t: Table) => row(t, "OPM %", "Financing Margin %");

function figures(f: Fundamentals, i: number): PeriodFigures | null {
  const q = f.quarters;
  if (i < 0 || i >= q.periods.length) return null;
  return {
    label: q.periods[i],
    revenue: revenueRow(f, q)[i] ?? null,
    ebitda: f.isLender ? null : opRow(f, q)[i] ?? null,
    pbt: row(q, "Profit before tax")[i] ?? null,
    pat: row(q, "Net Profit")[i] ?? null,
  };
}

// Fallback results card straight from the quarterly table.
export function resultsFromTable(f: Fundamentals): ResultsCard | null {
  const n = f.quarters.periods.length;
  const cur = figures(f, n - 1);
  if (!cur || cur.revenue == null) return null;
  return {
    source: "screener",
    basis: f.consolidated ? "Consolidated" : "Standalone",
    unit: "Rs crore",
    isLender: f.isLender,
    current: cur,
    previous: figures(f, n - 2),
    yearAgo: figures(f, n - 5),
    crossChecked: null,
  };
}

export interface Trend {
  label: string;
  periods: string[];
  values: (number | null)[];
  unit: string;
}

export function yoySeries(vals: (number | null)[], lag: number): (number | null)[] {
  return vals.map((v, i) => (i >= lag ? pct(v, vals[i - lag]) : null));
}

export function cagr(vals: (number | null)[], years: number): number | null {
  const clean = vals.filter((v): v is number => v != null);
  if (clean.length <= years) return null;
  const end = clean[clean.length - 1];
  const start = clean[clean.length - 1 - years];
  if (start <= 0 || end <= 0) return null;
  return (Math.pow(end / start, 1 / years) - 1) * 100;
}

// Annual tables carry a trailing "TTM" column on the P&L; drop it for year maths.
export function fiscalOnly(t: Table): Table {
  const keep = t.periods.map((p) => !/ttm/i.test(p));
  return {
    periods: t.periods.filter((_, i) => keep[i]),
    rows: Object.fromEntries(Object.entries(t.rows).map(([k, v]) => [k, v.filter((_, i) => keep[i])])),
  };
}

export interface CashQuality {
  years: string[];
  cfo: (number | null)[];
  pat: (number | null)[];
  conversion: number | null; // cumulative CFO / cumulative PAT, last up to 5 years
  fcf: (number | null)[];
}

export function cashQuality(f: Fundamentals): CashQuality | null {
  const cf = f.cashflow;
  const pl = fiscalOnly(f.annual);
  const cfo = row(cf, "Cash from Operating Activity");
  if (!cfo.length) return null;
  const n = Math.min(5, cf.periods.length);
  const years = cf.periods.slice(-n);
  const patAll = row(pl, "Net Profit");
  const pat = years.map((y) => {
    const i = pl.periods.indexOf(y);
    return i >= 0 ? patAll[i] ?? null : null;
  });
  const cfoN = cfo.slice(-n);
  const inv = row(cf, "Cash from Investing Activity").slice(-n);
  const sum = (a: (number | null)[]) => a.reduce<number>((s, v) => s + (v ?? 0), 0);
  const sp = sum(pat);
  return {
    years,
    cfo: cfoN,
    pat,
    conversion: sp > 0 ? (sum(cfoN) / sp) * 100 : null,
    fcf: row(cf, "Free Cash Flow").length
      ? row(cf, "Free Cash Flow").slice(-n)
      : cfoN.map((c, i) => (c == null || inv[i] == null ? null : c + (inv[i] as number))),
  };
}

export interface BalanceView {
  years: string[];
  borrowings: (number | null)[];
  equity: (number | null)[];
  debtToEquity: (number | null)[];
  cycle: { periods: string[]; days: (number | null)[]; label: string } | null;
}

export function balanceView(f: Fundamentals): BalanceView | null {
  const b = f.balance;
  if (!b.periods.length) return null;
  const n = Math.min(6, b.periods.length);
  const borrow = row(b, "Borrowings", "Borrowing").slice(-n);
  const cap = row(b, "Equity Capital").slice(-n);
  const res = row(b, "Reserves").slice(-n);
  const equity = cap.map((c, i) => (c == null || res[i] == null ? null : c + (res[i] as number)));
  const r = f.ratiosTable;
  const ccc = row(r, "Cash Conversion Cycle");
  const wc = row(r, "Working Capital Days");
  const cyc = ccc.length ? { d: ccc, label: "Cash conversion cycle" } : wc.length ? { d: wc, label: "Working capital days" } : null;
  return {
    years: b.periods.slice(-n),
    borrowings: borrow,
    equity,
    debtToEquity: borrow.map((d, i) => (d == null || !equity[i] ? null : d / (equity[i] as number))),
    cycle: cyc ? { periods: r.periods.slice(-n), days: cyc.d.slice(-n), label: cyc.label } : null,
  };
}

// Compact text block of the numbers handed to the grading model, with growth
// rates pre-computed so the model compares rather than does arithmetic.
export function numbersBrief(f: Fundamentals): string {
  const q = f.quarters;
  const nq = Math.min(9, q.periods.length);
  const fmt = (v: number | null | undefined, d = 0) => (v == null ? "-" : v.toFixed(d));
  const tail = <T,>(a: T[], n: number) => a.slice(-n);
  const lines: string[] = [];
  const sales = revenueRow(f, q);
  const np = row(q, "Net Profit");
  lines.push(`QUARTERLY (${f.consolidated ? "consolidated" : "standalone"}, Rs crore). Columns: ${tail(q.periods, nq).join(" | ")}`);
  lines.push(`Revenue: ${tail(sales, nq).map((v) => fmt(v)).join(" | ")}`);
  lines.push(`Revenue YoY %: ${tail(yoySeries(sales, 4), nq).map((v) => fmt(v, 1)).join(" | ")}`);
  lines.push(`Revenue QoQ %: ${tail(yoySeries(sales, 1), nq).map((v) => fmt(v, 1)).join(" | ")}`);
  lines.push(`${f.isLender ? "Financing profit" : "Operating profit (EBITDA)"}: ${tail(opRow(f, q), nq).map((v) => fmt(v)).join(" | ")}`);
  lines.push(`${f.isLender ? "Financing margin" : "EBITDA margin"} %: ${tail(marginRow(f, q), nq).map((v) => fmt(v, 1)).join(" | ")}`);
  lines.push(`Profit before tax: ${tail(row(q, "Profit before tax"), nq).map((v) => fmt(v)).join(" | ")}`);
  lines.push(`Net profit: ${tail(np, nq).map((v) => fmt(v)).join(" | ")}`);
  lines.push(`Net profit YoY %: ${tail(yoySeries(np, 4), nq).map((v) => fmt(v, 1)).join(" | ")}`);

  const a = f.annual;
  const na = Math.min(6, a.periods.length);
  const as = revenueRow(f, a);
  const an = row(a, "Net Profit");
  lines.push("");
  lines.push(`ANNUAL (Rs crore). Columns: ${tail(a.periods, na).join(" | ")}`);
  lines.push(`Revenue: ${tail(as, na).map((v) => fmt(v)).join(" | ")}`);
  lines.push(`Revenue growth %: ${tail(yoySeries(as, 1), na).map((v) => fmt(v, 1)).join(" | ")} (ignore the TTM column for growth)`);
  lines.push(`EBITDA margin %: ${tail(marginRow(f, a), na).map((v) => fmt(v, 1)).join(" | ")}`);
  lines.push(`Net profit: ${tail(an, na).map((v) => fmt(v)).join(" | ")}`);

  const cq = cashQuality(f);
  if (cq) {
    lines.push("");
    lines.push(`CASH FLOW (Rs crore). Columns: ${cq.years.join(" | ")}`);
    lines.push(`Cash from operations: ${cq.cfo.map((v) => fmt(v)).join(" | ")}`);
    lines.push(`Net profit: ${cq.pat.map((v) => fmt(v)).join(" | ")}`);
    lines.push(`Cash from investing (mostly capex): ${tail(row(f.cashflow, "Cash from Investing Activity"), cq.years.length).map((v) => fmt(v)).join(" | ")}`);
    lines.push(`Cumulative cash conversion (CFO / net profit): ${fmt(cq.conversion, 0)}%`);
  }
  const bv = balanceView(f);
  if (bv) {
    lines.push("");
    lines.push(`BALANCE SHEET (Rs crore). Columns: ${bv.years.join(" | ")}`);
    lines.push(`Borrowings: ${bv.borrowings.map((v) => fmt(v)).join(" | ")}`);
    lines.push(`Shareholders' equity: ${bv.equity.map((v) => fmt(v)).join(" | ")}`);
    lines.push(`Debt to equity: ${bv.debtToEquity.map((v) => fmt(v, 2)).join(" | ")}`);
    if (bv.cycle) lines.push(`${bv.cycle.label} (days), columns ${bv.cycle.periods.join(" | ")}: ${bv.cycle.days.map((v) => fmt(v)).join(" | ")}`);
  }
  return lines.join("\n");
}

// ---------- Forensic screens, computed from the reported tables, no model ----------

export interface Check {
  label: string;
  pass: boolean | null;
  detail: string;
  proxy?: string; // set when the textbook input is not in the data and a stand-in was used
}

function yearPair(f: Fundamentals): { t: string; p: string } | null {
  const years = f.cashflow.periods;
  if (years.length < 2) return null;
  return { t: years[years.length - 1], p: years[years.length - 2] };
}

function val(t: Table, period: string, ...labels: string[]): number | null {
  const i = t.periods.indexOf(period);
  if (i < 0) return null;
  return row(t, ...labels)[i] ?? null;
}

const div = (a: number | null, b: number | null) => (a == null || b == null || b === 0 ? null : a / b);
const cmp = (a: number | null, b: number | null, better: "up" | "down") =>
  a == null || b == null ? null : better === "up" ? a > b : a < b;
const f2 = (v: number | null, d = 1) => (v == null ? "n/a" : v.toFixed(d));

export interface Piotroski {
  score: number;
  outOf: number;
  year: string;
  checks: Check[];
}

// Piotroski F-Score: nine yes/no tests of profitability, leverage and efficiency.
// Two inputs (current ratio, gross margin) are not in the standardised tables, so
// labelled stand-ins are used. Not meaningful for lenders.
export function piotroski(f: Fundamentals): Piotroski | null {
  if (f.isLender) return null;
  const y = yearPair(f);
  if (!y) return null;
  const pl = fiscalOnly(f.annual), bs = f.balance, cf = f.cashflow;
  const ni = (p: string) => val(pl, p, "Net Profit");
  const ta = (p: string) => val(bs, p, "Total Assets");
  const sales = (p: string) => val(pl, p, "Sales", "Revenue");
  const roa = (p: string) => div(ni(p), ta(p));
  const cfo = val(cf, y.t, "Cash from Operating Activity");
  const lev = (p: string) => div(val(bs, p, "Borrowings", "Borrowing"), ta(p));
  const liq = (p: string) => div(val(bs, p, "Other Assets"), val(bs, p, "Other Liabilities"));
  const opm = (p: string) => val(pl, p, "OPM %");
  const turn = (p: string) => div(sales(p), ta(p));
  const pctTxt = (v: number | null) => (v == null ? "n/a" : `${(v * 100).toFixed(1)}%`);
  const checks: Check[] = [
    { label: "Profitable", pass: ni(y.t) == null ? null : (ni(y.t) as number) > 0, detail: `Return on assets ${pctTxt(roa(y.t))}` },
    { label: "Operating cash positive", pass: cfo == null ? null : cfo > 0, detail: `Cash from operations Rs ${f2(cfo, 0)} crore` },
    { label: "Return on assets improved", pass: cmp(roa(y.t), roa(y.p), "up"), detail: `${pctTxt(roa(y.p))} to ${pctTxt(roa(y.t))}` },
    { label: "Cash earnings exceed profit", pass: cmp(cfo, ni(y.t), "up"), detail: `Cash Rs ${f2(cfo, 0)} crore against profit Rs ${f2(ni(y.t), 0)} crore` },
    { label: "Leverage fell", pass: cmp(lev(y.t), lev(y.p), "down"), detail: `Borrowings to assets ${pctTxt(lev(y.p))} to ${pctTxt(lev(y.t))}` },
    { label: "Liquidity improved", pass: cmp(liq(y.t), liq(y.p), "up"), detail: `${f2(liq(y.p), 2)} to ${f2(liq(y.t), 2)}`, proxy: "Other assets over other liabilities stands in for the current ratio" },
    { label: "No new shares issued", pass: cmp(val(bs, y.t, "Equity Capital"), (val(bs, y.p, "Equity Capital") ?? 0) + 0.5, "down"), detail: `Equity capital Rs ${f2(val(bs, y.p, "Equity Capital"), 0)} to ${f2(val(bs, y.t, "Equity Capital"), 0)} crore` },
    { label: "Margin improved", pass: cmp(opm(y.t), opm(y.p), "up"), detail: `${f2(opm(y.p))}% to ${f2(opm(y.t))}%`, proxy: "Operating margin stands in for gross margin" },
    { label: "Asset turnover improved", pass: cmp(turn(y.t), turn(y.p), "up"), detail: `${f2(turn(y.p), 2)}× to ${f2(turn(y.t), 2)}×` },
  ];
  const known = checks.filter((c) => c.pass != null);
  if (known.length < 6) return null;
  return { score: known.filter((c) => c.pass).length, outOf: known.length, year: y.t, checks };
}

export interface Beneish {
  m: number;
  zone: "high" | "grey" | "low";
  year: string;
  parts: { key: string; label: string; value: number; reads: string }[];
  approximations: string[];
}

// Beneish M-Score, eight-variable form. Above -1.78 is the usual flag for possible
// earnings manipulation. Two of the eight inputs are approximated; see `approximations`.
export function beneish(f: Fundamentals): Beneish | null {
  if (f.isLender) return null;
  const y = yearPair(f);
  if (!y) return null;
  const pl = fiscalOnly(f.annual), bs = f.balance, cf = f.cashflow, rt = f.ratiosTable;
  const ta = (p: string) => val(bs, p, "Total Assets");
  const sales = (p: string) => val(pl, p, "Sales", "Revenue");
  const dd = (p: string) => val(rt, p, "Debtor Days");
  const opm = (p: string) => val(pl, p, "OPM %");
  const aq = (p: string) => {
    const hard = (val(bs, p, "Other Assets") ?? 0) + (val(bs, p, "Fixed Assets") ?? 0);
    const t = ta(p);
    return t ? 1 - hard / t : null;
  };
  const depRate = (p: string) => {
    const d = val(pl, p, "Depreciation"), fa = val(bs, p, "Fixed Assets");
    return d == null || fa == null || d + fa === 0 ? null : d / (d + fa);
  };
  const lev = (p: string) => {
    const t = ta(p);
    return t ? ((val(bs, p, "Borrowings", "Borrowing") ?? 0) + (val(bs, p, "Other Liabilities") ?? 0)) / t : null;
  };
  const dsri = div(dd(y.t), dd(y.p));
  const gmi = div(opm(y.p), opm(y.t));
  const aqiRaw = div(aq(y.t), aq(y.p));
  const aqi = aqiRaw == null || aqiRaw < 0 || aqiRaw > 5 ? 1 : aqiRaw;
  const sgi = div(sales(y.t), sales(y.p));
  const depi = div(depRate(y.p), depRate(y.t));
  const lvgi = div(lev(y.t), lev(y.p));
  const ni = val(pl, y.t, "Net Profit"), cfo = val(cf, y.t, "Cash from Operating Activity");
  const tata = ni == null || cfo == null || !ta(y.t) ? null : (ni - cfo) / (ta(y.t) as number);
  if ([dsri, gmi, sgi, depi, lvgi, tata].some((v) => v == null)) return null;
  const sgai = 1;
  const m = -4.84 + 0.92 * dsri! + 0.528 * gmi! + 0.404 * aqi + 0.892 * sgi! + 0.115 * depi! - 0.172 * sgai + 4.679 * tata! - 0.327 * lvgi!;
  return {
    m: Math.round(m * 100) / 100,
    zone: m > -1.78 ? "high" : m > -2.22 ? "grey" : "low",
    year: y.t,
    parts: [
      { key: "DSRI", label: "Receivables against sales", value: dsri!, reads: dsri! > 1.1 ? "Receivables grew faster than sales" : "Receivables in step with sales" },
      { key: "GMI", label: "Margin deterioration", value: gmi!, reads: gmi! > 1.05 ? "Margin fell" : "Margin held" },
      { key: "AQI", label: "Asset quality", value: aqi, reads: aqi > 1.2 ? "More of the balance sheet is soft assets" : "No shift toward soft assets" },
      { key: "SGI", label: "Sales growth", value: sgi!, reads: sgi! > 1.3 ? "Fast growth, which raises the pressure to keep it up" : "Ordinary growth" },
      { key: "DEPI", label: "Depreciation rate", value: depi!, reads: depi! > 1.1 ? "Depreciation rate slowed" : "Depreciation rate steady" },
      { key: "LVGI", label: "Leverage", value: lvgi!, reads: lvgi! > 1.05 ? "Liabilities rose against assets" : "Leverage steady or lower" },
      { key: "TATA", label: "Accruals to assets", value: tata!, reads: tata! > 0.05 ? "Profit well ahead of cash" : "Profit backed by cash" },
    ],
    approximations: [
      "Gross margin is not in the standardised tables, so operating margin is used for the margin index.",
      "Selling and admin costs are not broken out, so that index is held at neutral (1.0).",
      "Receivables are taken from debtor days; soft assets are capital work in progress plus investments.",
    ],
  };
}

// ---------- The arithmetic behind a promise verdict ----------

export function gap(low: number | null | undefined, high: number | null | undefined, actual: number | null | undefined, unit: string | null | undefined): string | null {
  if (actual == null || (low == null && high == null)) return null;
  const u = (unit || "").trim();
  const isRate = u === "%" || u === "bps";
  const show = (v: number) => `${v.toLocaleString("en-IN", { maximumFractionDigits: 1 })}${u === "%" ? "%" : u ? ` ${u}` : ""}`;
  const lo = low ?? -Infinity, hi = high ?? Infinity;
  const target = low != null && high != null && low !== high ? `${show(low)} to ${show(high)}` : low != null && high == null ? `at least ${show(low)}` : high != null && low == null ? `at most ${show(high)}` : show((low ?? high) as number);
  if (actual >= lo && actual <= hi) return `Target ${target}; reported ${show(actual)}. Inside the target.`;
  const bound = actual < lo ? lo : hi;
  const diff = actual - bound;
  const how = isRate
    ? `${Math.abs(u === "bps" ? diff : diff * 100).toFixed(0)} bps`
    : `${Math.abs((diff / Math.abs(bound)) * 100).toFixed(1)}%`;
  return `Target ${target}; reported ${show(actual)}. ${actual < lo ? "Short" : "Over"} by ${how} (${show(actual)} − ${show(bound)}${isRate ? "" : `, divided by ${show(bound)}`}).`;
}

export const DIMENSIONS: { key: string; label: string; match: RegExp }[] = [
  { key: "revenue", label: "Revenue and volumes", match: /revenue|volume|sales|growth/i },
  { key: "margin", label: "Margins and profit", match: /margin|profit|pat|ebitda/i },
  { key: "capex", label: "Capex and capacity", match: /capex|capacity/i },
  { key: "cash", label: "Cash and balance sheet", match: /cash|working|debt/i },
];

export function dimensionOf(metric: string): string {
  // Margin first: "margin growth" is a margin promise, not a revenue one.
  for (const k of ["margin", "capex", "cash", "revenue"]) {
    const d = DIMENSIONS.find((x) => x.key === k)!;
    if (d.match.test(metric)) return d.label;
  }
  return "Other";
}
