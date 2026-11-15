# FINN

A mobile-first investment agent for a portfolio of NSE-listed companies. It does two things:

- **Today (push).** Every exchange filing across the portfolio for a window you choose, sorted into *Matters*, *Worth a glance* and *Buried*, with the reason each one ranked where it did. Results filings show Revenue, EBITDA, PBT and PAT against last quarter and last year, read from the filing itself. Management changes show who the person is. Price and volume moves are flagged against thresholds you set, and marked as explained by a filing or not.
- **Ledger (pull).** For any NSE symbol, FINN reads the last six earnings-call transcripts, lists what management promised, checks each quote appears word for word in the transcript, and grades every promise against the numbers the company later reported. Around it: latest quarter, trajectory, cash quality, balance sheet, and a case each way.

The two are joined: when a results filing lands, its card says which earlier promises that quarter settled.

Also in the app, all computed in code with no model call: alerts with the reason they matter, a scan of price moves against filings, a price chart with filings marked, a 60-second audio brief, a per-topic view of where management's word holds, Piotroski and approximate Beneish screens, and a count of governance filings. The model additionally tracks a commitment restated across calls and whether its number was lowered.

## Run it

Needs Node 20 or newer.

```
npm install
```

Create a file named `.env.local` containing one line: `GEMINI_API_KEY=your-key`

```
npm run probe      # one-minute check of every data source; writes probe-out/report.txt
npm run ingest     # builds data/snapshot.json and public/data/* from live sources
npm run dev        # http://localhost:3000
```

`npm run ingest` is safe to re-run: fundamentals, model calls and ledgers are cached on disk, so a run stopped by a rate limit picks up where it left off. Useful flags: `--days=45`, `--no-llm`, `--fresh`, `--ledger-all`. `npm run ledger -- KAYNES` builds one company's ledger.

To change the portfolio, edit `config/portfolio.json` and re-run ingest.

## Deploy

Push to GitHub with Vercel connected to the repo. In the Vercel project settings add the environment variable `GEMINI_API_KEY`, then redeploy. The committed snapshot serves the portfolio; the three routes under `/api/research` serve live research on any other symbol.

## How it is built

| Step | How | Model |
|---|---|---|
| Prices | Yahoo Finance chart endpoint, end of day | none |
| Fundamentals, transcript links | screener.in company page, parsed | none |
| Filings | NSE announcements API, BSE as fallback | none |
| Sorting filings | Fixed rules on the subject line (`lib/classify.ts`) | none |
| Filings the rules cannot place, and one-liners | One batched call | low-cost |
| Results numbers | Only the PDF pages holding the results table | low-cost |
| Management change | Brief profile inside the filing | low-cost |
| Promises per earnings call | Only forward-looking speaker turns | low-cost |
| Grading promises, story versus numbers, case each way | One call per company, growth rates pre-computed in code | stronger |
| Latest quarter, trajectory, cash, balance sheet | Arithmetic in `lib/derive.ts` | none |

Model names are discovered from the key at run time (`lib/gemini.ts`) rather than hard-coded. The Rules tab shows calls, tokens and estimated cost per step.

Pull-side analysis uses only the company's transcripts and reported numbers. Prompts forbid outside knowledge, quotes are verified against the transcript text in code, and a metric that is not in the reported tables is marked as not checkable rather than guessed.

## Layout

```
app/            page, styles, /api/research/{company,extract,synthesize}
components/     Today, LedgerTab, Rules, shared UI
lib/            sources/, classify, gemini, pdf, enrich, ledger, derive, client
scripts/        probe, ingest, make-sample
config/         portfolio.json
data/           snapshot.json, cache/
public/data/    fundamentals/ and ledger/ per company
```
