export type ResearchDepth = "quick" | "standard" | "deep";
export interface ResearchToolInput { topic: string; depth?: ResearchDepth; focus?: string[]; }
export interface ResearchSource { title: string; url: string; snippet: string; query: string; }
export interface ResearchReport {
  topic: string; depth: ResearchDepth; queries: string[]; executiveSummary: string;
  insights: string[]; recommendations: string[]; limitations: string[];
  sources: ResearchSource[]; published?: { path: string; commitSha: string; htmlUrl: string };
  generatedAt: string;
}
export interface ResearchEnv {
  AI: { run(model: string, input: Record<string, unknown>): Promise<unknown> };
  AI_MODEL?: string; GITHUB_TOKEN?: string; GITHUB_REPOSITORY?: string;
  GITHUB_BRANCH?: string; GITHUB_RESEARCH_PUBLISH?: string; GITHUB_REPORTS_PATH?: string;
}
