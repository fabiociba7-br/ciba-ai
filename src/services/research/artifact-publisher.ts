import type { ResearchEnv, ResearchReport } from "./types";
const encoder = new TextEncoder();
function base64Url(bytes: Uint8Array): string {
  let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}
export function renderResearchMarkdown(report: ResearchReport): string {
  return ["# " + report.topic, "", "**Gerado em:** " + report.generatedAt, "**Profundidade:** " + report.depth, "",
    "## Resumo executivo", "", report.executiveSummary, "", "## Principais achados", "",
    ...report.insights.map((x) => "- " + x), "", "## Recomendações", "", ...report.recommendations.map((x) => "- " + x),
    "", "## Limitações", "", ...report.limitations.map((x) => "- " + x), "", "## Fontes", "",
    ...report.sources.map((s) => "- [" + s.title + "](" + s.url + ") — " + s.snippet)].join("\n");
}
export class CloudflareArtifactPublisher {
  constructor(private readonly env: ResearchEnv) {}
  private ownerPrefix(): string { return "owners/" + this.env.ownerId + "/"; }
  async signedUrl(key: string): Promise<string> {
    if (!key.startsWith(this.ownerPrefix())) throw new Error("artifact_owner_scope_violation");
    if (!this.env.ARTIFACT_URL_SECRET) throw new Error("artifact_url_secret_not_configured");
    const ttl = Math.min(Math.max(Number(this.env.ARTIFACT_URL_TTL_SECONDS || 3600), 300), 86400);
    const expires = Math.floor(Date.now() / 1000) + ttl;
    const signature = await hmac(this.env.ARTIFACT_URL_SECRET, key + "\n" + expires);
    const base = (this.env.PUBLIC_API_BASE_URL || "").replace(/\/+$/, "");
    return base + "/v1/artifacts/" + encodeURIComponent(key) + "?expires=" + expires + "&sig=" + encodeURIComponent(signature);
  }
  async putImage(key: string, bytes: Uint8Array, mimeType: string): Promise<string> {
    if (!key.startsWith(this.ownerPrefix()) || bytes.byteLength < 1 || bytes.byteLength > 8_000_000) throw new Error("artifact_image_invalid");
    await this.env.GARCIA_ARTIFACTS.put(key, bytes, { httpMetadata: { contentType: mimeType, cacheControl: "private, max-age=300" },
      customMetadata: { ownerId: this.env.ownerId, appId: this.env.appId } });
    return this.signedUrl(key);
  }
  async publishResearch(report: ResearchReport): Promise<{ json_url: string; markdown_url: string }> {
    const id = crypto.randomUUID(), prefix = this.ownerPrefix() + "research/" + id;
    const jsonKey = prefix + ".json", mdKey = prefix + ".md";
    await this.env.GARCIA_ARTIFACTS.put(jsonKey, JSON.stringify(report, null, 2), {
      httpMetadata: { contentType: "application/json; charset=utf-8" }, customMetadata: { ownerId: this.env.ownerId, appId: this.env.appId } });
    await this.env.GARCIA_ARTIFACTS.put(mdKey, renderResearchMarkdown(report), {
      httpMetadata: { contentType: "text/markdown; charset=utf-8" }, customMetadata: { ownerId: this.env.ownerId, appId: this.env.appId } });
    await this.env.DB.prepare("INSERT INTO research_artifacts (artifact_id, owner_id, app_id, report_json_r2_key, report_md_r2_key, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, this.env.ownerId, this.env.appId, jsonKey, mdKey, new Date().toISOString()).run();
    return { json_url: await this.signedUrl(jsonKey), markdown_url: await this.signedUrl(mdKey) };
  }
  async verifySignedUrl(key: string, expires: number, signature: string): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    if (!key.startsWith(this.ownerPrefix()) || !this.env.ARTIFACT_URL_SECRET || !Number.isInteger(expires) || expires < now || expires > now + 86400) return false;
    const expected = await hmac(this.env.ARTIFACT_URL_SECRET, key + "\n" + expires);
    if (expected.length !== signature.length) return false;
    let diff = 0; for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    return diff === 0;
  }
}
