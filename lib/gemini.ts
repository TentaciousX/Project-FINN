import { sleep } from "./http";
import type { UsageRow } from "./types";

// Two routes, picked per step:
//   cheap  - Flash-Lite class: bulk extraction, classification, one-liners
//   strong - Flash class: only the single grading and synthesis call per company
// Model names change often and some hang or have no free quota on a given key,
// so each route is an ordered chain discovered from the key. A call walks the
// chain until a model answers, then remembers that model for the rest of the run.

const BASE = "https://generativelanguage.googleapis.com/v1beta";
export type Route = "cheap" | "strong";

export interface LlmCache {
  get(key: string): Promise<{ text: string; inTok: number; outTok: number } | null>;
  set(key: string, val: { text: string; inTok: number; outTok: number }): Promise<void>;
}

export interface LlmOpts {
  key?: string;
  cache?: LlmCache;
  onUsage?: (row: UsageRow) => void;
  maxWaitMs?: number; // total time we are willing to sit out rate limits
  attemptMs?: number; // time allowed for one model to answer
  model?: string; // force one model (used by the probe to time each candidate)
}

export type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

const SKIP = /image|tts|audio|live|embedding|vision|computer|robotics|native|learnlm|gemma|aqa|imagen|veo|omni|transcribe|banana|customtools|research|antigravity|lyria/;
const ALIAS: Record<Route, string> = { cheap: "gemini-flash-lite-latest", strong: "gemini-flash-latest" };

function versionOf(name: string): number {
  const m = name.match(/gemini-(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}

export function chainFrom(names: string[], route: Route): string[] {
  const lite = (n: string) => /flash-lite/.test(n);
  const versioned = names
    .filter((n) => /^gemini-\d/.test(n) && !SKIP.test(n))
    .filter((n) => (route === "cheap" ? lite(n) : /flash/.test(n) && !lite(n)))
    .sort((a, b) => {
      const pa = /preview|exp/.test(a) ? 1 : 0;
      const pb = /preview|exp/.test(b) ? 1 : 0;
      return pa - pb || versionOf(b) - versionOf(a) || a.length - b.length;
    })
    .slice(0, 4);
  const hasAlias = names.length === 0 || names.includes(ALIAS[route]);
  // The lite alias has been reliable; the flash alias has been seen to hang, so it goes last.
  const out = route === "cheap" ? [...(hasAlias ? [ALIAS.cheap] : []), ...versioned] : [...versioned, ...(hasAlias ? [ALIAS.strong] : [])];
  return [...new Set(out)];
}

export async function listModels(key: string): Promise<string[]> {
  const res = await fetch(`${BASE}/models?pageSize=200`, {
    headers: { "x-goog-api-key": key },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Gemini model list failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
  return (j.models ?? [])
    .filter((m) => (m.supportedGenerationMethods ?? ["generateContent"]).includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""));
}

let chains: Record<Route, string[]> | null = null;
const noThinking = new Set<string>();

async function chainFor(key: string, route: Route): Promise<string[]> {
  if (!chains) {
    let names: string[] = [];
    try {
      names = await listModels(key);
    } catch {
      // Fall through to aliases; the first real call will surface a bad key.
    }
    const env = { cheap: process.env.GEMINI_MODEL_CHEAP?.trim(), strong: process.env.GEMINI_MODEL_STRONG?.trim() };
    chains = {
      cheap: [...new Set([...(env.cheap ? [env.cheap] : []), ...chainFrom(names, "cheap")])],
      strong: [...new Set([...(env.strong ? [env.strong] : []), ...chainFrom(names, "strong")])],
    };
    // If no Flash-class model answers, grade with the best Flash-Lite rather than fail.
    chains.strong.push(...chains.cheap.slice(0, 2).filter((m) => !chains!.strong.includes(m)));
  }
  return chains[route];
}

export async function candidates(key: string, route: Route): Promise<string[]> {
  return [...(await chainFor(key, route))];
}

// The model currently at the head of each chain (the last one that worked).
export async function resolveModels(key: string): Promise<Record<Route, string>> {
  return { cheap: (await chainFor(key, "cheap"))[0], strong: (await chainFor(key, "strong"))[0] };
}

function hash(s: string): string {
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619) >>> 0;
    b = Math.imul(b + c, 2246822519) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0") + s.length.toString(16);
}

export function parseJson<T>(text: string): T {
  let t = text.trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(t) as T;
  } catch {
    const s = Math.min(...[t.indexOf("{"), t.indexOf("[")].filter((i) => i >= 0));
    const e = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
    if (Number.isFinite(s) && e > s) return JSON.parse(t.slice(s, e + 1)) as T;
    throw new Error(`Model did not return JSON: ${t.slice(0, 160)}`);
  }
}

class NextModel extends Error {}

interface Answer {
  text: string;
  inTok: number;
  outTok: number;
}

async function callOne(model: string, key: string, system: string, parts: Part[], maxOut: number, attemptMs: number, deadline: number): Promise<Answer> {
  let attempt = 0;
  for (;;) {
    attempt++;
    const generationConfig: Record<string, unknown> = {
      temperature: 0.1,
      responseMimeType: "application/json",
      maxOutputTokens: maxOut,
    };
    // Newer models think before answering; these tasks are extraction and comparison, so keep it short.
    if (!noThinking.has(model) && (versionOf(model) >= 3 || /latest/.test(model))) {
      generationConfig.thinkingConfig = { thinkingLevel: "low" };
    }
    let res: Response;
    try {
      res = await fetch(`${BASE}/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts }],
          generationConfig,
        }),
        signal: AbortSignal.timeout(attemptMs),
      });
    } catch (e) {
      throw new NextModel(`${model} did not answer within ${Math.round(attemptMs / 1000)}s (${(e as Error).name})`);
    }
    if (res.ok) {
      const j = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
      };
      const text = (j.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
      if (!text) throw new NextModel(`${model} returned no text (finish: ${j.candidates?.[0]?.finishReason ?? "unknown"})`);
      return {
        text,
        inTok: j.usageMetadata?.promptTokenCount ?? 0,
        outTok: (j.usageMetadata?.candidatesTokenCount ?? 0) + (j.usageMetadata?.thoughtsTokenCount ?? 0),
      };
    }
    const err = (await res.text()).slice(0, 400);
    if (res.status === 401 || res.status === 403) throw new Error(`Gemini rejected the key (HTTP ${res.status}): ${err}`);
    if (res.status === 400 && /thinking/i.test(err) && !noThinking.has(model)) {
      noThinking.add(model);
      continue;
    }
    if (res.status === 400 || res.status === 404) throw new NextModel(`${model} HTTP ${res.status}: ${err}`);
    if (res.status === 429 && /limit: 0|per ?day|PerDay/i.test(err)) throw new NextModel(`${model} has no free quota left today`);
    if (attempt >= 4) throw new NextModel(`${model} HTTP ${res.status} after ${attempt} tries: ${err}`);
    const hinted = err.match(/"retryDelay":\s*"(\d+)(?:\.\d+)?s"/);
    const wait = Math.min(hinted ? (parseInt(hinted[1], 10) + 2) * 1000 : 6000 * attempt, 65000);
    if (Date.now() + wait > deadline) throw new NextModel(`${model} is rate limited (HTTP ${res.status})`);
    await sleep(wait);
  }
}

export async function llmJson<T>(
  step: string,
  route: Route,
  system: string,
  parts: Part[],
  opts: LlmOpts & { naiveChars?: number; maxOutputTokens?: number } = {}
): Promise<T> {
  const key = opts.key ?? process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const naiveInTok = opts.naiveChars ? Math.round(opts.naiveChars / 4) : undefined;

  const cacheKey = hash(
    route + "|" + system + "|" + parts.map((p) => ("text" in p ? p.text : `pdf:${p.inline_data.data.length}:${p.inline_data.data.slice(0, 256)}`)).join("|")
  );
  if (opts.cache) {
    const hit = await opts.cache.get(cacheKey);
    if (hit) {
      opts.onUsage?.({ ts: new Date().toISOString(), step, model: "cache", route, inTok: hit.inTok, outTok: hit.outTok, cached: true, naiveInTok });
      return parseJson<T>(hit.text);
    }
  }

  const chain = opts.model ? [opts.model] : await chainFor(key, route);
  const deadline = Date.now() + (opts.maxWaitMs ?? 240000);
  const failures: string[] = [];
  for (const model of [...chain]) {
    try {
      const a = await callOne(model, key, system, parts, opts.maxOutputTokens ?? 8192, opts.attemptMs ?? 80000, deadline);
      const parsed = parseJson<T>(a.text); // throws before caching a bad answer
      // Remember the model that worked: move it to the head of the chain.
      if (!opts.model) {
        chain.splice(chain.indexOf(model), 1);
        chain.unshift(model);
      }
      await opts.cache?.set(cacheKey, a);
      opts.onUsage?.({ ts: new Date().toISOString(), step, model, route, inTok: a.inTok, outTok: a.outTok, cached: false, naiveInTok });
      return parsed;
    } catch (e) {
      if (!(e instanceof NextModel) && !/did not return JSON/.test((e as Error).message)) throw e;
      failures.push((e as Error).message);
      if (Date.now() > deadline) break;
    }
  }
  throw new Error(`No ${route} model answered. ${failures.join(" | ")}`);
}

// List prices in USD per million tokens, used only for the cost meter estimate.
// The free tier bills nothing; this shows what the same run would cost at list price.
export const LIST_PRICE: Record<Route, { in: number; out: number }> = {
  cheap: { in: 0.1, out: 0.4 },
  strong: { in: 0.3, out: 2.5 },
};
export const USD_INR = 88;
