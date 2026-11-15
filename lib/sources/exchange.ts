import { get, getJson, sleep, UA } from "../http";

// One normalised shape for a raw exchange filing, before classification.
export interface RawFiling {
  id: string;
  symbol: string;
  company: string;
  ts: string;
  headline: string;
  body: string;
  exchangeCategory: string;
  url: string | null;
  source: "NSE" | "BSE";
}

const pad = (n: number) => String(n).padStart(2, "0");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ---------- NSE ----------
// NSE's API only answers a session that has first loaded the site, so we
// collect cookies from the home page. It often refuses cloud IPs; BSE is the fallback.
let nseCookie: string | null = null;
let nseDown = false;

async function nseSession(): Promise<string> {
  if (nseCookie) return nseCookie;
  const res = await get("https://www.nseindia.com/companies-listing/corporate-filings-announcements", {
    retries: 0,
    timeoutMs: 8000,
  });
  const set = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  nseCookie = set.map((c) => c.split(";")[0]).join("; ");
  if (!nseCookie) throw new Error(`NSE gave no session cookies (HTTP ${res.status})`);
  return nseCookie;
}

interface NseRow {
  symbol: string; desc: string; attchmntFile?: string; attchmntText?: string;
  an_dt: string; sm_name?: string; seq_id?: string; sort_date?: string;
}

function nseDate(s: string): string | null {
  // "14-Nov-2026 18:22:11"
  const m = s.match(/(\d{2})-([A-Za-z]{3})-(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const mi = MON.findIndex((x) => x.toLowerCase() === m[2].toLowerCase());
  if (mi < 0) return null;
  return `${m[3]}-${pad(mi + 1)}-${m[1]}T${m[4]}:${m[5]}:${m[6] ?? "00"}+05:30`;
}

export async function fetchNse(symbol: string, from: Date, to: Date): Promise<RawFiling[]> {
  const cookie = await nseSession();
  const f = (d: Date) => `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
  const url = `https://www.nseindia.com/api/corporate-announcements?index=equities&symbol=${encodeURIComponent(
    symbol
  )}&from_date=${f(from)}&to_date=${f(to)}`;
  const rows = await getJson<NseRow[]>(url, {
    retries: 0,
    timeoutMs: 8000,
    headers: {
      Cookie: cookie,
      Referer: "https://www.nseindia.com/companies-listing/corporate-filings-announcements",
      Accept: "application/json, text/plain, */*",
      "User-Agent": UA,
    },
  });
  if (!Array.isArray(rows)) throw new Error("NSE returned an unexpected shape");
  const out: RawFiling[] = [];
  for (const r of rows) {
    const ts = nseDate(r.an_dt || r.sort_date || "");
    if (!ts) continue;
    out.push({
      id: `NSE-${symbol}-${r.seq_id || ts}`,
      symbol,
      company: r.sm_name || symbol,
      ts,
      headline: (r.desc || "").trim(),
      body: (r.attchmntText || "").trim(),
      exchangeCategory: (r.desc || "").trim(),
      url: r.attchmntFile && r.attchmntFile.startsWith("http") ? r.attchmntFile : null,
      source: "NSE",
    });
  }
  return out;
}

// ---------- BSE ----------
interface BseRow {
  NEWSID: string; SCRIP_CD: number | string; NEWSSUB?: string; HEADLINE?: string; MORE?: string;
  NEWS_DT?: string; DT_TM?: string; CATEGORYNAME?: string; SUBCATNAME?: string;
  ATTACHMENTNAME?: string; SLONGNAME?: string;
}

export async function fetchBse(symbol: string, bseCode: string, from: Date, to: Date): Promise<RawFiling[]> {
  const f = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const out: RawFiling[] = [];
  for (let page = 1; page <= 6; page++) {
    const url =
      `https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w?pageno=${page}&strCat=-1` +
      `&strPrevDate=${f(from)}&strScrip=${bseCode}&strSearch=P&strToDate=${f(to)}&strType=C&subcategory=-1`;
    let j: { Table?: BseRow[] } | null = null;
    let lastErr: unknown;
    // BSE intermittently answers with an HTML error page or a malformed response; a short wait fixes it.
    for (let attempt = 0; attempt < 4 && !j; attempt++) {
      try {
        j = await getJson<{ Table?: BseRow[] }>(url, {
          retries: 0,
          headers: {
            Referer: "https://www.bseindia.com/",
            Origin: "https://www.bseindia.com",
            Accept: "application/json, text/plain, */*",
          },
        });
      } catch (e) {
        lastErr = e;
        await sleep(1500 * (attempt + 1));
      }
    }
    if (!j) throw lastErr instanceof Error ? new Error(lastErr.message.slice(0, 160)) : new Error("BSE did not answer");
    const rows = j.Table ?? [];
    for (const r of rows) {
      const raw = r.NEWS_DT || r.DT_TM || "";
      const m = raw.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
      if (!m) continue;
      const sub = (r.NEWSSUB || "").replace(/^.*?-\s*\d{6}\s*-\s*/, "").trim();
      out.push({
        id: `BSE-${r.NEWSID}`,
        symbol,
        company: r.SLONGNAME || symbol,
        ts: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+05:30`,
        headline: sub || (r.HEADLINE || "").slice(0, 160),
        body: ((r.MORE || "").trim() || (r.HEADLINE || "").trim()).replace(/^.*?\s\.{3,}\s/, ""),
        exchangeCategory: [r.CATEGORYNAME, r.SUBCATNAME].filter(Boolean).join(" / "),
        url: r.ATTACHMENTNAME
          ? `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${r.ATTACHMENTNAME}`
          : null,
        source: "BSE",
      });
    }
    if (rows.length < 50) break;
  }
  return out;
}

// NSE first (the brief is NSE-centric), BSE when NSE refuses us.
export async function fetchFilings(
  symbol: string,
  bseCode: string | null,
  from: Date,
  to: Date,
  log: (s: string) => void = () => {}
): Promise<RawFiling[]> {
  if (!nseDown) {
    try {
      return await fetchNse(symbol, from, to);
    } catch (e) {
      // NSE refuses most scripted clients. Ask once, then use BSE for the rest of the run.
      nseDown = true;
      log(`  NSE unreachable (${(e as Error).message}); using BSE for all symbols`);
    }
  }
  if (!bseCode) throw new Error(`No BSE code for ${symbol}, and NSE was unreachable`);
  return fetchBse(symbol, bseCode, from, to);
}

// BSE moves attachments from AttachLive to AttachHis after a while.
export function bseAlternate(url: string): string | null {
  if (url.includes("/AttachLive/")) return url.replace("/AttachLive/", "/AttachHis/");
  if (url.includes("/AttachHis/")) return url.replace("/AttachHis/", "/AttachLive/");
  return null;
}
