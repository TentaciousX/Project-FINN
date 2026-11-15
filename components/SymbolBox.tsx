"use client";
import { useState } from "react";

// The one interactive thing on the start page: try the product before reading about it.
export default function SymbolBox({ examples }: { examples: string[] }) {
  const [v, setV] = useState("");
  const go = (s: string) => {
    const sym = s.trim().toUpperCase();
    if (sym) window.location.href = `/app#ledger/${encodeURIComponent(sym)}`;
  };
  return (
    <form className="lp-try" onSubmit={(e) => { e.preventDefault(); go(v); }}>
      <label htmlFor="lp-sym">NSE symbol</label>
      <div>
        <input id="lp-sym" value={v} onChange={(e) => setV(e.target.value)} placeholder={examples[0] || "KAYNES"} autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
        <button type="submit">Check their word</button>
      </div>
      <p>
        Or open one that is ready:{" "}
        {examples.map((s, i) => (
          <span key={s}>
            {i > 0 && ", "}
            <a href={`/app#ledger/${s}`}>{s}</a>
          </span>
        ))}
      </p>
    </form>
  );
}
