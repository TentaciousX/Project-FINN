import { getJson } from "../http";
import type { PriceSeries } from "../types";

interface YahooChart {
  chart: {
    result?: {
      timestamp?: number[];
      indicators: { quote: { close: (number | null)[]; volume: (number | null)[] }[] };
    }[];
    error?: { description?: string } | null;
  };
}

// End-of-day close and volume. Tries NSE (.NS) first, then BSE (.BO).
export async function fetchPrices(symbol: string, range = "6mo"): Promise<PriceSeries> {
  let lastErr: unknown;
  for (const suffix of [".NS", ".BO"]) {
    for (const host of ["query1", "query2"]) {
      try {
        const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
          symbol + suffix
        )}?range=${range}&interval=1d`;
        const j = await getJson<YahooChart>(url, { retries: 1 });
        const r = j.chart.result?.[0];
        if (!r?.timestamp?.length) throw new Error(j.chart.error?.description || "empty chart");
        const q = r.indicators.quote[0];
        const out: PriceSeries = { dates: [], close: [], volume: [] };
        r.timestamp.forEach((t, i) => {
          const c = q.close[i];
          const v = q.volume[i];
          if (c == null || v == null) return;
          // Yahoo stamps the bar at market open UTC; shift to IST for the calendar date.
          const d = new Date((t + 5.5 * 3600) * 1000).toISOString().slice(0, 10);
          out.dates.push(d);
          out.close.push(Math.round(c * 100) / 100);
          out.volume.push(v);
        });
        if (out.dates.length < 5) throw new Error("too few bars");
        return out;
      } catch (e) {
        lastErr = e;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
