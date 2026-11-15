import { NextResponse } from "next/server";
import { fetchFundamentals } from "../../../../lib/sources/screener";
import { allow, SYMBOL } from "../../../../lib/ratelimit";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

// Live fundamentals for any NSE ticker. No model call, so this works without a key.
export async function GET(req: Request) {
  const symbol = (new URL(req.url).searchParams.get("symbol") || "").trim().toUpperCase();
  if (!allow(req, 30)) return NextResponse.json({ error: "Too many requests. Wait a minute and try again." }, { status: 429 });
  if (!SYMBOL.test(symbol)) return NextResponse.json({ error: "That does not look like an NSE symbol." }, { status: 400 });
  try {
    const f = await fetchFundamentals(symbol);
    return NextResponse.json({ fundamentals: f, hasKey: Boolean(process.env.GEMINI_API_KEY) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
