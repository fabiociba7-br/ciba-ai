import { RobustDuckDuckGoClient } from "./duckduckgo";
import { GitHubResearchPublisher } from "./github-publisher";
import { generateQueries, synthesizeResearch } from "./synthesizer";
import type { ResearchEnv, ResearchReport, ResearchToolInput } from "./types";
export class GarciaResearchService {
  constructor(private readonly env: ResearchEnv, private readonly search = new RobustDuckDuckGoClient()) {}
  async research(input: ResearchToolInput): Promise<ResearchReport> {
    const topic = input.topic.trim();
    if (topic.length < 3 || topic.length > 300) throw new Error("invalid_research_topic");
    const depth = input.depth || "standard";
    if (!["quick", "standard", "deep"].includes(depth)) throw new Error("invalid_research_depth");
    const focus = (input.focus || []).filter((v) => typeof v === "string" && v.trim() && v.length <= 80).slice(0, 8).map((v) => v.trim());
    const queries = await generateQueries(this.env, topic, depth, focus);
    const collected = []; const failures: string[] = [];
    for (const query of queries) {
      try { collected.push(...await this.search.search(query)); }
      catch (error) { failures.push(error instanceof Error ? error.message : "search_failed"); if (failures.length >= 2 && !collected.length) break; }
    }
    const sources = [...new Map(collected.map((s) => [s.url, s])).values()].slice(0, 20);
    if (!sources.length) throw new Error(failures.includes("duckduckgo_challenge_detected") ? "research_provider_challenge" : "research_no_sources");
    const synthesis = await synthesizeResearch(this.env, topic, depth, queries, sources);
    const report: ResearchReport = { topic, depth, queries, ...synthesis, sources, generatedAt: new Date().toISOString(),
      ...(failures.length ? { limitations: [...synthesis.limitations, "Falhas parciais de busca: " + failures.slice(0, 3).join(", ")] } : {}) };
    if (this.env.GITHUB_RESEARCH_PUBLISH !== "false" && this.env.GITHUB_TOKEN && this.env.GITHUB_REPOSITORY) {
      report.published = await new GitHubResearchPublisher(this.env.GITHUB_TOKEN, this.env.GITHUB_REPOSITORY,
        this.env.GITHUB_BRANCH || "main", this.env.GITHUB_REPORTS_PATH || "reports/garcia-research").publish(report);
    }
    return report;
  }
}
