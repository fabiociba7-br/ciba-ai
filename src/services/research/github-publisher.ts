import type { ResearchReport } from "./types";
const API = "https://api.github.com";
function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value); let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function slug(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "research";
}
export class GitHubResearchPublisher {
  constructor(private readonly token: string, private readonly repository: string, private readonly branch = "main",
    private readonly reportsPath = "reports/garcia-research", private readonly fetcher: typeof fetch = fetch) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("invalid_github_repository");
    if (!/^[A-Za-z0-9._/-]{1,100}$/.test(branch) || branch.includes("..")) throw new Error("invalid_github_branch");
    if (!token) throw new Error("github_token_required");
  }
  async publish(report: ResearchReport): Promise<ResearchReport["published"]> {
    const stamp = report.generatedAt.replace(/[:.]/g, "-");
    const path = this.reportsPath.replace(/^\/+|\/+$/g, "") + "/" + report.generatedAt.slice(0, 10) + "/" + slug(report.topic) + "-" + stamp + ".md";
    const endpoint = API + "/repos/" + this.repository + "/contents/" + path.split("/").map(encodeURIComponent).join("/");
    const headers = { Authorization: "Bearer " + this.token, Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" };
    const current = await this.fetcher(endpoint + "?ref=" + encodeURIComponent(this.branch), { method: "GET", headers, cache: "no-store" });
    let sha: string | undefined;
    if (current.ok) { const data = await current.json() as { sha?: string }; sha = data.sha; if (!sha) throw new Error("github_existing_file_sha_missing"); }
    else if (current.status !== 404) throw new Error("github_contents_read_failed_" + current.status);
    const response = await this.fetcher(endpoint, {
      method: "PUT", headers, cache: "no-store",
      body: JSON.stringify({ message: "research: " + report.topic.slice(0, 72), content: base64Utf8(renderResearchMarkdown(report)),
        branch: this.branch, ...(sha ? { sha } : {}) }),
    });
    if (response.status === 409 || response.status === 422) throw new Error("github_commit_conflict_or_branch_protection");
    if (!response.ok) throw new Error("github_contents_write_failed_" + response.status);
    const data = await response.json() as { commit?: { sha?: string }; content?: { html_url?: string } };
    if (!data.commit?.sha) throw new Error("github_commit_sha_missing");
    return { path, commitSha: data.commit.sha, htmlUrl: data.content?.html_url || "https://github.com/" + this.repository + "/blob/" + this.branch + "/" + path };
  }
}
export function renderResearchMarkdown(report: ResearchReport): string {
  return [
    "# Pesquisa Garcia: " + report.topic, "", "- Gerado em: " + report.generatedAt,
    "- Profundidade: " + report.depth, "", "## Resumo executivo", "", report.executiveSummary,
    "", "## Consultas", ...report.queries.map((q) => "- " + q),
    "", "## Insights", ...report.insights.map((x) => "- " + x),
    "", "## Recomendações", ...report.recommendations.map((x) => "- " + x),
    "", "## Limitações", ...report.limitations.map((x) => "- " + x),
    "", "## Fontes", ...report.sources.map((s) => "- [" + s.title + "](" + s.url + ") — " + s.snippet), "",
  ].join("\n");
}
