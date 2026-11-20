import { describe, expect, it, vi } from "vitest";
import { parseDuckDuckGoHtml, RobustDuckDuckGoClient } from "../../src/services/research/duckduckgo";
import { CloudflareArtifactPublisher, verifySignedArtifactUrl } from "../../src/services/research/artifact-publisher";
import { GarciaResearchService } from "../../src/services/research/service";
import { VisualCurator } from "../../src/services/research/visual-curator";
import type { ResearchEnv, ResearchReport, ResearchSource } from "../../src/services/research/types";

const sampleHtml = '<div class="result results_links"><h2><a class="result__a" href="https://example.com/security">Example security</a></h2><a class="result__snippet">An example security advisory.</a></div>' +
  '<div class="result results_links"><h2><a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fowasp.org%2Fapi">OWASP API</a></h2><a class="result__snippet">API security guidance.</a></div>';
const report: ResearchReport = {
  topic: "OAuth2 security", depth: "quick", queries: ["OAuth2 security"],
  executiveSummary: "Review primary sources.", insights: ["Use PKCE."],
  recommendations: ["Validate redirect URIs."], limitations: [],
  sources: [{ title: "OWASP", url: "https://owasp.org/", snippet: "Guidance", query: "OAuth2" }],
  generatedAt: "2026-11-20T10:00:00.000Z",
};
function mockEnv(ai: { run: ReturnType<typeof vi.fn> }): ResearchEnv {
  const statement = () => ({ bind: () => statement(), run: async () => ({ meta: { changes: 1 } }), first: async () => null });
  const db = { prepare: () => statement(), batch: async (items: unknown[]) => items.map(() => ({ meta: { changes: 1 } })) };
  const r2 = { put: vi.fn(async () => ({})), get: vi.fn(async () => null), delete: vi.fn(async () => {}) };
  const kv = { get: vi.fn(async () => null), put: vi.fn(async () => {}) };
  return { AI: ai as never, DB: db as never, GARCIA_ARTIFACTS: r2 as never, GARCIA_PROMPT_CACHE: kv as never,
    AI_MODEL: "test-model", ARTIFACT_URL_SECRET: "test-secret", PUBLIC_API_BASE_URL: "https://api.example.test",
    ownerId: "owner-test", appId: "com.ciba.garcia", deviceId: "device-test" };
}
describe("Garcia native research and visual storage", () => {
  it("parses DuckDuckGo result links and unwraps redirect URLs", () => {
    const results = parseDuckDuckGoHtml(sampleHtml, "OAuth2");
    expect(results).toHaveLength(2);
    expect(results[0].url).toBe("https://example.com/security");
    expect(results[1].url).toBe("https://owasp.org/api");
  });
  it("uses isolate cache for repeated queries", async () => {
    const fetcher = vi.fn(async () => new Response(sampleHtml, { status: 200 }));
    const client = new RobustDuckDuckGoClient(fetcher, 0);
    const first = await client.search("unique-cache-test-2026");
    const second = await client.search("unique-cache-test-2026");
    expect(first).toEqual(second);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("stores report JSON and Markdown in R2 and returns signed URLs", async () => {
    const ai = { run: vi.fn() };
    const env = mockEnv(ai);
    const publisher = new CloudflareArtifactPublisher(env);
    const urls = await publisher.publishResearch(report);
    expect(urls.json_url).toContain("/v1/artifacts/owners%2Fowner-test");
    expect(urls.markdown_url).toContain(".md?");
    const signed = new URL(urls.json_url);
    const key = decodeURIComponent(signed.pathname.slice("/v1/artifacts/".length));
    expect(await verifySignedArtifactUrl("test-secret", key, Number(signed.searchParams.get("expires")), signed.searchParams.get("sig") || "")).toBe(true);
    expect(await verifySignedArtifactUrl("wrong-secret", key, Number(signed.searchParams.get("expires")), signed.searchParams.get("sig") || "")).toBe(false);
    expect((env.GARCIA_ARTIFACTS as never as { put: ReturnType<typeof vi.fn> }).put).toHaveBeenCalledTimes(2);
  });
  it("runs query planning, search, synthesis and R2 publication through Workers AI", async () => {
    const ai = { run: vi.fn()
      .mockResolvedValueOnce({ response: '{"queries":["OAuth2 PKCE"]}' })
      .mockResolvedValueOnce({ response: '{"executiveSummary":"PKCE mitigates interception.","insights":["Use PKCE for public clients."],"recommendations":["Enforce exact redirect URI matching."],"limitations":[]}' }) };
    const env = mockEnv(ai);
    const source: ResearchSource = { title: "OAuth guidance", url: "https://example.org/oauth", snippet: "PKCE protects authorization code flows.", query: "OAuth2 PKCE" };
    const search = { search: vi.fn(async () => [source]) };
    const service = new GarciaResearchService(env, search as never);
    const result = await service.research({ topic: "OAuth2 security", depth: "quick", focus: ["PKCE"] });
    expect("queries" in result).toBe(true);
    if (!("queries" in result)) throw new Error("expected_research_report");
    expect(result.queries).toEqual(["OAuth2 PKCE"]);
    expect(result.sources).toHaveLength(1);
    expect(result.insights[0]).toContain("PKCE");
    expect(result.artifacts?.json_url).toContain("/v1/artifacts/");
    expect(search.search).toHaveBeenCalledTimes(1);
    expect(ai.run).toHaveBeenCalledTimes(2);
  });
  it("creates a visual session and generates an image through FLUX multipart Workers AI", async () => {
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jW9sAAAAASUVORK5CYII=";
    const ai = { run: vi.fn()
      .mockResolvedValueOnce({ response: '{"refined_prompt":"OAuth2 architecture diagram, backend emphasized"}' })
      .mockResolvedValueOnce({ image: png })
      .mockResolvedValueOnce({ response: '{"score":94,"analysis":"O backend está destacado e o fluxo PKCE está legível."}' }) };
    const env = mockEnv(ai);
    const result = await new VisualCurator(env).createOrIterate({
      topic: "Diagrama visual OAuth2", visual_mode: true, mode: "generate", focus: ["backend", "PKCE"],
    });
    expect(result.iteration).toBe(1);
    expect(result.session_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(result.image_url).toContain("/v1/artifacts/");
    expect(result.visual_analysis).toContain("backend");
    expect(ai.run).toHaveBeenCalledTimes(3);
    expect(ai.run.mock.calls[1][0]).toBe("@cf/black-forest-labs/flux-2-klein-4b");
    expect(ai.run.mock.calls[1][1]).toHaveProperty("multipart");
  });

});
