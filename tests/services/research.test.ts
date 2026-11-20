import { describe, expect, it, vi } from "vitest";
import { parseDuckDuckGoHtml, RobustDuckDuckGoClient } from "../../src/services/research/duckduckgo";
import { GitHubResearchPublisher } from "../../src/services/research/github-publisher";
import { GarciaResearchService } from "../../src/services/research/service";
import type { ResearchReport, ResearchSource } from "../../src/services/research/types";

const sampleHtml = '<div class="result results_links"><h2><a class="result__a" href="https://example.com/security">Example security</a></h2><a class="result__snippet">An example security advisory.</a></div>' +
  '<div class="result results_links"><h2><a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fowasp.org%2Fapi">OWASP API</a></h2><a class="result__snippet">API security guidance.</a></div>';
const report: ResearchReport = {
  topic: "OAuth2 security", depth: "quick", queries: ["OAuth2 security"],
  executiveSummary: "Review primary sources.", insights: ["Use PKCE."],
  recommendations: ["Validate redirect URIs."], limitations: [],
  sources: [{ title: "OWASP", url: "https://owasp.org/", snippet: "Guidance", query: "OAuth2" }],
  generatedAt: "2026-11-20T10:00:00.000Z",
};

describe("Garcia native research", () => {
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
  it("creates a GitHub Contents API commit without force push", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        commit: { sha: "abc123" }, content: { html_url: "https://github.com/example/repo/blob/main/report.md" },
      }), { status: 201, headers: { "Content-Type": "application/json" } }));
    const publisher = new GitHubResearchPublisher("token", "example/repo", "main", "reports", fetcher);
    const result = await publisher.publish(report);
    expect(result?.commitSha).toBe("abc123");
    expect(fetcher).toHaveBeenCalledTimes(2);
    const put = fetcher.mock.calls[1];
    expect(put[1]?.method).toBe("PUT");
    expect(String(put[1]?.body)).toContain('"branch":"main"');
    expect(String(put[1]?.body)).not.toContain("force");
  });
  it("runs query planning, search and synthesis through injected Worker AI", async () => {
    const ai = { run: vi.fn()
      .mockResolvedValueOnce({ response: '{"queries":["OAuth2 PKCE"]}' })
      .mockResolvedValueOnce({ response: '{"executiveSummary":"PKCE mitigates interception.","insights":["Use PKCE for public clients."],"recommendations":["Enforce exact redirect URI matching."],"limitations":[]}' }) };
    const source: ResearchSource = { title: "OAuth guidance", url: "https://example.org/oauth", snippet: "PKCE protects authorization code flows.", query: "OAuth2 PKCE" };
    const search = { search: vi.fn(async () => [source]) };
    const service = new GarciaResearchService({ AI: ai, AI_MODEL: "test-model", GITHUB_RESEARCH_PUBLISH: "false" }, search as never);
    const result = await service.research({ topic: "OAuth2 security", depth: "quick", focus: ["PKCE"] });
    expect(result.queries).toEqual(["OAuth2 PKCE"]);
    expect(result.sources).toHaveLength(1);
    expect(result.insights[0]).toContain("PKCE");
    expect(search.search).toHaveBeenCalledTimes(1);
    expect(ai.run).toHaveBeenCalledTimes(2);
  });
});
