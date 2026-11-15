// Small fetch wrapper: browser-like headers, timeout, polite retries.

export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface GetOpts {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
}

export async function get(url: string, opts: GetOpts = {}): Promise<Response> {
  const { headers = {}, timeoutMs = 20000, retries = 2 } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/json,application/pdf;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          ...headers,
        },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status} for ${url}`);
        await sleep(1500 * (attempt + 1));
        continue;
      }
      return res;
    } catch (e) {
      const cause = (e as { cause?: { code?: string; message?: string } }).cause;
      lastErr = new Error(`${(e as Error).message}${cause ? ` (${cause.code || cause.message})` : ""} for ${url.slice(0, 90)}`);
      if (attempt < retries) await sleep(1500 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function getText(url: string, opts?: GetOpts): Promise<string> {
  const res = await get(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

export async function getJson<T = unknown>(url: string, opts?: GetOpts): Promise<T> {
  const res = await get(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Not JSON from ${url}: ${text.slice(0, 120)}`);
  }
}

export async function getBytes(url: string, opts?: GetOpts): Promise<Uint8Array> {
  const res = await get(url, { timeoutMs: 45000, ...opts });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

// Filing PDFs live on exchange or company hosts; exchanges want a Referer.
export function refererFor(url: string): Record<string, string> {
  if (url.includes("bseindia.com")) return { Referer: "https://www.bseindia.com/" };
  if (url.includes("nseindia.com")) return { Referer: "https://www.nseindia.com/" };
  return {};
}
