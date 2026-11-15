import { NextResponse } from "next/server";
import { fetchFundamentals } from "../../../../lib/sources/screener";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

// Live fundamentals for any NSE ticker. No model call, so this works without a key.
export async function GET(req: Request) {
  const symbol = new URL(req.url).searchParams.get("symbol") || "";
  try {
    const f = await fetchFundamentals(symbol);
    return NextResponse.json({ fundamentals: f, hasKey: Boolean(process.env.GEMINI_API_KEY) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
