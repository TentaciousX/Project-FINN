import { NextResponse } from "next/server";
import { synthesize } from "../../../../lib/ledger";
import type { UsageRow } from "../../../../lib/types";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// The single strong-model call: grade every promise against the reported numbers.
export async function POST(req: Request) {
  try {
    const { fundamentals, calls, promises } = await req.json();
    if (!fundamentals?.symbol || !Array.isArray(calls)) return NextResponse.json({ error: "fundamentals and calls are required" }, { status: 400 });
    const usage: UsageRow[] = [];
    const ledger = await synthesize(fundamentals, calls, promises ?? [], { onUsage: (r) => usage.push(r), maxWaitMs: 50000, attemptMs: 26000 });
    return NextResponse.json({ ledger, usage });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
