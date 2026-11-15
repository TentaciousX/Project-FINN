// A small in-memory limiter for the live research routes. It is per server
// instance, so it is a guard against accidental hammering, not a security control.
const hits = new Map<string, number[]>();

export function allow(req: Request, max = 12, windowMs = 60000): boolean {
  const ip = (req.headers.get("x-forwarded-for") || "local").split(",")[0].trim();
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) {
    hits.set(ip, list);
    return false;
  }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 2000) hits.clear();
  return true;
}

export const SYMBOL = /^[A-Z0-9&\-]{1,12}$/;
