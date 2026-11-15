import { NextResponse } from "next/server";
import { extractCall } from "../../../../lib/ledger";
import { allow, SYMBOL } from "../../../../lib/ratelimit";
import type { UsageRow } from "../../../../lib/types";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// One earnings call per request, so each stays inside the serverless time limit
// and the phone can show progress call by call.
export async function POST(req: Request) {
  if (!allow(req)) return NextResponse.json({ error: "Too many requests. Wait a minute and try again." }, { status: 429 });
  try {
    const { symbol, name, concall } = await req.json();
    if (!symbol || !SYMBOL.test(String(symbol)) || !/^https:\/\//.test(String(concall?.transcriptUrl || ""))) return NextResponse.json({ error: "symbol and concall are required" }, { status: 400 });
    const usage: UsageRow[] = [];
    const out = await extractCall(String(symbol), String(name || symbol), concall, { onUsage: (r) => usage.push(r), maxWaitMs: 50000, attemptMs: 26000 });
    return NextResponse.json({ ...out, usage });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
