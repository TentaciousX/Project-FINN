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
