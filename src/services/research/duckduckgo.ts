import type { ResearchSource } from "./types";
const CACHE_TTL_MS = 600_000;
const cache = new Map<string, { expiresAt: number; results: ResearchSource[] }>();
export class SearchBlockedError extends Error {
  constructor(message = "duckduckgo_rate_limited_or_blocked") { super(message); this.name = "SearchBlockedError"; }
}
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const jitter = (min: number, max: number) => min + Math.random() * (max - min);
function decodeHtml(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)));
}
const stripTags = (value: string) => decodeHtml(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).trim();
function resolveUrl(raw: string): string | null {
  try {
    const parsed = new URL(decodeHtml(raw), "https://html.duckduckgo.com");
    if (parsed.hostname.endsWith("duckduckgo.com")) {
      if (parsed.pathname.includes("/y.js")) return null;
      const target = parsed.searchParams.get("uddg");
      return target ? resolveUrl(target) : null;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    parsed.hash = ""; return parsed.toString();
  } catch { return null; }
}
export function parseDuckDuckGoHtml(html: string, query: string): ResearchSource[] {
  const blocks = html.match(/<div[^>]*class=["'][^"']*result[^"']*["'][^>]*>[\s\S]*?(?=<div[^>]*class=["'][^"']*result[^"']*["']|$)/gi) || [];
  const results: ResearchSource[] = [];
  for (const block of blocks) {
    const a = block.match(/<a[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i)
      || block.match(/<a[^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*result__a[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const url = resolveUrl(a[1]); const title = stripTags(a[2]);
    const snip = block.match(/<(?:a|div)[^>]*class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/i);
    if (!url || !title || results.some((r) => r.url === url)) continue;
    results.push({ title: title.slice(0, 300), url, snippet: snip ? stripTags(snip[1]).slice(0, 1200) : "", query });
    if (results.length >= 8) break;
  }
  return results;
}
function retryAfter(response: Response): number | null {
  const raw = response.headers.get("retry-after"); if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds * 1000, 0), 20_000);
  const date = Date.parse(raw); return Number.isFinite(date) ? Math.min(Math.max(date - Date.now(), 0), 20_000) : null;
}
export class RobustDuckDuckGoClient {
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly maxRetries = 2) {}
  async search(query: string): Promise<ResearchSource[]> {
    const key = query.trim().replace(/\s+/g, " ").toLowerCase();
    if (!key || key.length > 400) throw new Error("invalid_research_query");
    const cached = cache.get(key); if (cached && cached.expiresAt > Date.now()) return cached.results;
    const url = new URL("https://html.duckduckgo.com/html/"); url.searchParams.set("q", query);
    let last: Error = new Error("duckduckgo_request_failed");
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      if (attempt) await sleep(jitter(1_500, 3_500) * attempt);
      try {
        const response = await this.fetcher(url.toString(), {
          method: "GET", cache: "no-store", redirect: "follow",
          headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7", Referer: "https://duckduckgo.com/" },
          signal: AbortSignal.timeout(8_000),
        });
        if (response.status === 429 || response.status === 503) {
          last = new SearchBlockedError("duckduckgo_http_" + response.status);
          if (attempt < this.maxRetries) { await sleep((retryAfter(response) ?? Math.min(1000 * (2 ** attempt), 8000)) + jitter(250, 900)); continue; }
          throw last;
        }
        if (!response.ok) throw new Error("duckduckgo_http_" + response.status);
        const html = await response.text();
        if (new TextEncoder().encode(html).byteLength > 1_500_000) throw new Error("duckduckgo_response_too_large");
        const results = parseDuckDuckGoHtml(html, query);
        if (!results.length) {
          if (/captcha|unusual traffic|bots use|anomaly-modal|challenge/i.test(html)) throw new SearchBlockedError("duckduckgo_challenge_detected");
          throw new Error("duckduckgo_no_parseable_results");
        }
        cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, results });
        if (cache.size > 128) { const first = cache.keys().next().value; if (first) cache.delete(first); }
        return results;
      } catch (error) {
        last = error instanceof Error ? error : new Error("duckduckgo_unknown_error");
        if (attempt >= this.maxRetries) break;
      }
    }
    throw last;
  }
}
