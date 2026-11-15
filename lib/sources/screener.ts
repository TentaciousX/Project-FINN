import * as cheerio from "cheerio";
import { getText } from "../http";
import type { Concall, Fundamentals, Table } from "../types";

const clean = (s: string) => s.replace(/ /g, " ").replace(/\s+/g, " ").trim();

// Text with a space between child nodes, so "<div>Oct 2026</div><a>Transcript</a>" does not fuse.
function spaced($: cheerio.CheerioAPI, el: Parameters<cheerio.CheerioAPI>[0]): string {
  const parts: string[] = [];
  const walk = (node: any) => {
    if (node.type === "text") parts.push(node.data);
    else if (node.children) node.children.forEach(walk);
  };
  $(el).each((_, n) => walk(n));
  return clean(parts.join(" "));
}

function num(s: string): number | null {
  const t = clean(s).replace(/,/g, "").replace(/%$/, "");
  if (t === "" || t === "-" || t === "--") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function parseTable($: cheerio.CheerioAPI, sectionId: string): Table {
  const out: Table = { periods: [], rows: {} };
  const table = $(`section#${sectionId} table.data-table`).first();
  if (!table.length) return out;
  table.find("thead th").each((i, th) => {
    if (i === 0) return;
    out.periods.push(clean($(th).text()));
  });
  table.find("tbody tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 2) return;
    const label = clean($(tds[0]).text()).replace(/\s*\+$/, "").trim();
    if (!label || /^raw pdf$/i.test(label)) return;
    const vals: (number | null)[] = [];
    tds.each((i, td) => {
      if (i === 0) return;
      vals.push(num($(td).text()));
    });
    out.rows[label] = vals;
  });
  return out;
}

function parseConcalls($: cheerio.CheerioAPI): Concall[] {
  const out: Concall[] = [];
  $("section#documents .concalls li, section#documents .documents.concalls li").each((_, li) => {
    const text = spaced($, li);
    const m = text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})(?!\d)/);
    if (!m) return;
    let transcriptUrl: string | null = null;
    let pptUrl: string | null = null;
    $(li)
      .find("a")
      .each((_, a) => {
        const label = spaced($, a).toLowerCase();
        const href = $(a).attr("href") || "";
        if (!href.startsWith("http")) return;
        if (label.includes("transcript")) transcriptUrl = href;
        else if (label.includes("ppt")) pptUrl = href;
      });
    const period = `${m[1]} ${m[2]}`;
    if (!out.some((c) => c.period === period)) out.push({ period, transcriptUrl, pptUrl });
  });
  return out;
}

export function parseScreener(html: string, symbol: string, url: string): Fundamentals {
  const $ = cheerio.load(html);
  const name = clean($("h1").first().text()) || symbol;
  const about = (clean($(".company-profile .about").first().text()) || clean($(".about").first().text())).replace(/\s*\[\d+\]/g, "");
  const pageText = clean($(".company-links").text() + " " + $(".company-info").text());
  const bse = pageText.match(/BSE:\s*(\d{6})/) || html.match(/bseindia\.com\/stock-share-price\/[^"']*?\/(\d{6})\//);
  const ratios: Record<string, string> = {};
  $("#top-ratios li").each((_, li) => {
    const k = clean($(li).find(".name").text());
    const v = clean($(li).find(".value, .nowrap").first().text());
    if (k && v) ratios[k] = v;
  });
  const quarters = parseTable($, "quarters");
  const annualReports: { title: string; url: string }[] = [];
  $("section#documents .annual-reports li a").each((_, a) => {
    const href = $(a).attr("href") || "";
    if (href.startsWith("http")) annualReports.push({ title: spaced($, a).replace(/\s*from (bse|nse)\s*$/i, ""), url: href });
  });
  return {
    symbol,
    name,
    about,
    url,
    bseCode: bse ? bse[1] : null,
    isLender: !("Sales" in quarters.rows) && "Revenue" in quarters.rows,
    consolidated: url.includes("/consolidated"),
    ratios,
    quarters,
    annual: parseTable($, "profit-loss"),
    balance: parseTable($, "balance-sheet"),
    cashflow: parseTable($, "cash-flow"),
    ratiosTable: parseTable($, "ratios"),
    concalls: parseConcalls($),
    annualReports: annualReports.slice(0, 6),
    fetchedAt: new Date().toISOString(),
  };
}

const hasNumbers = (f: Fundamentals) =>
  f.quarters.periods.length > 0 &&
  Object.values(f.quarters.rows).some((r) => r.some((v) => v != null));

// Any NSE ticker: consolidated numbers when they exist, standalone otherwise.
export async function fetchFundamentals(symbol: string): Promise<Fundamentals> {
  const sym = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9&\-]{1,20}$/.test(sym)) throw new Error("That does not look like an NSE symbol.");
  const enc = encodeURIComponent(sym);
  const tries = [
    `https://www.screener.in/company/${enc}/consolidated/`,
    `https://www.screener.in/company/${enc}/`,
  ];
  let lastErr: unknown;
  for (const url of tries) {
    try {
      const html = await getText(url, { headers: { Referer: "https://www.screener.in/" } });
      const f = parseScreener(html, sym, url);
      if (hasNumbers(f)) return f;
      lastErr = new Error(`No financial tables found for ${sym} on screener.in`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
