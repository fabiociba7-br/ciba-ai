import type { ResearchSourceImage } from "./types";
import { SearchBlockedError } from "./duckduckgo";
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const jitter = (min: number, max: number) => min + Math.random() * (max - min);
function isSafePublicHttpUrl(value: string): boolean {
  try {
    const u = new URL(value), host = u.hostname.toLowerCase();
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    if (!host || host.startsWith("[") || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") ||
        host === "0.0.0.0" || host === "::1" ||
        /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return false;
    return true;
  } catch { return false; }
}
export class DuckDuckGoImageClient {
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  async search(query: string): Promise<ResearchSourceImage[]> {
    const pageUrl = new URL("https://duckduckgo.com/");
    pageUrl.searchParams.set("q", query); pageUrl.searchParams.set("iax", "images"); pageUrl.searchParams.set("ia", "images");
    const page = await this.fetcher(pageUrl.toString(), { cache: "no-store", headers: { Accept: "text/html", "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8" }, signal: AbortSignal.timeout(8000) });
    if (page.status === 429 || page.status === 503) throw new SearchBlockedError("duckduckgo_images_http_" + page.status);
    if (!page.ok) throw new Error("duckduckgo_images_page_http_" + page.status);
    const html = await page.text();
    if (/captcha|unusual traffic|anomaly-modal|challenge/i.test(html)) throw new SearchBlockedError("duckduckgo_images_challenge");
    const token = html.match(/vqd=['"]?([\d-]+)['"]?/i)?.[1] || html.match(/vqd=([\d-]+)/i)?.[1];
    if (!token) throw new Error("duckduckgo_images_token_missing");
    const api = new URL("https://duckduckgo.com/i.js");
    api.searchParams.set("l", "us-en"); api.searchParams.set("o", "json"); api.searchParams.set("q", query);
    api.searchParams.set("vqd", token); api.searchParams.set("f", ",,,"); api.searchParams.set("p", "1");
    let response: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt) await sleep(jitter(1800, 3200) * attempt);
      response = await this.fetcher(api.toString(), { cache: "no-store", headers: {
        Accept: "application/json, text/javascript, */*; q=0.01", Referer: pageUrl.toString(),
      }, signal: AbortSignal.timeout(8000) });
      if (response.status !== 429 && response.status !== 503) break;
    }
    if (!response?.ok) throw new Error("duckduckgo_images_api_failed");
    const payload: unknown = await response.json();
    const items = payload && typeof payload === "object" && Array.isArray((payload as { results?: unknown }).results)
      ? (payload as { results: unknown[] }).results : [];
    return items.slice(0, 8).flatMap((item): ResearchSourceImage[] => {
      if (!item || typeof item !== "object") return [];
      const x = item as Record<string, unknown>, imageUrl = typeof x.image === "string" ? x.image : "";
      const page = typeof x.url === "string" ? x.url : imageUrl;
      if (!isSafePublicHttpUrl(imageUrl) || !isSafePublicHttpUrl(page)) return [];
      return [{ title: typeof x.title === "string" ? x.title.slice(0, 300) : "Imagem de referência",
        pageUrl: page, imageUrl, ...(typeof x.thumbnail === "string" ? { thumbnailUrl: x.thumbnail } : {}),
        ...(typeof x.width === "number" ? { width: x.width } : {}), ...(typeof x.height === "number" ? { height: x.height } : {}) }];
    });
  }
  async download(candidate: ResearchSourceImage): Promise<{ bytes: Uint8Array; mimeType: "image/png" | "image/jpeg" | "image/webp" } | null> {
    let current = candidate.imageUrl;
    for (let redirects = 0; redirects <= 2; redirects += 1) {
      if (!isSafePublicHttpUrl(current)) return null;
      const response = await this.fetcher(current, { method: "GET", redirect: "manual", cache: "no-store",
        headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5" }, signal: AbortSignal.timeout(9000) });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location"); if (!location || redirects === 2) return null;
        current = new URL(location, current).toString(); continue;
      }
      if (!response.ok) return null;
      const mime = (response.headers.get("content-type") || "").split(";")[0].toLowerCase();
      if (!["image/png", "image/jpeg", "image/webp"].includes(mime)) return null;
      if (Number(response.headers.get("content-length") || 0) > 8_000_000) return null;
      if (!response.body) return null;
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.byteLength;
        if (total > 8_000_000) { await reader.cancel(); return null; }
        chunks.push(part.value);
      }
      if (!total) return null;
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return { bytes, mimeType: mime as "image/png" | "image/jpeg" | "image/webp" };
    }
    return null;
  }
}
