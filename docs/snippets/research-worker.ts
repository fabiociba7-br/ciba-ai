/**
 * Reference integration for the Garcia Cloudflare Worker.
 *
 * Bind GITHUB_RESEARCH_TOKEN as a Worker secret (Actions: write; Contents:
 * write only if the workflow is allowed to commit). Never expose it to clients.
 * The worker dispatches the workflow and returns 202; clients poll a separate
 * status endpoint. A durable queue/job table should persist requestId/runId in
 * production rather than keeping a request open while research executes.
 */
export interface ResearchJobEnv {
  GITHUB_RESEARCH_TOKEN: string;
  GITHUB_REPOSITORY: string; // owner/repo
  GITHUB_RESEARCH_WORKFLOW?: string; // research-job.yml
  GITHUB_RESEARCH_REF?: string; // feat/garcia-research-package
}

type ResearchDepth = "quick" | "standard" | "deep";
type ResearchToolArgs = { topic: string; depth?: ResearchDepth; focus?: string[] };

const GH_API = "https://api.github.com";

export async function dispatchGarciaResearch(
  env: ResearchJobEnv,
  args: ResearchToolArgs,
  requestId: string,
): Promise<{ accepted: true; request_id: string }> {
  const topic = args.topic.trim();
  if (topic.length < 3 || topic.length > 300) throw new Error("invalid_research_topic");
  const focus = (args.focus || []).slice(0, 8).map((v) => v.trim()).filter(Boolean);
  const response = await fetch(
    `${GH_API}/repos/${env.GITHUB_REPOSITORY}/actions/workflows/${env.GITHUB_RESEARCH_WORKFLOW || "research-job.yml"}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_RESEARCH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ref: env.GITHUB_RESEARCH_REF || "feat/garcia-research-package",
        inputs: {
          topic,
          depth: args.depth || "standard",
          focus: focus.join(","),
          request_id: requestId,
          publish: "false",
        },
      }),
    },
  );
  if (response.status !== 204) {
    // Do not forward GitHub's raw response; it may contain operational details.
    throw new Error(`research_dispatch_failed_http_${response.status}`);
  }
  return { accepted: true, request_id: requestId };
}

/*
 * Tool definition passed to the existing LLM tool registry:
 *
 * import schema from "../../garcia_research/tool_schema.json";
 * tools: [schema]
 *
 * On a tool call:
 * const args = JSON.parse(toolCall.function.arguments) as ResearchToolArgs;
 * const requestId = crypto.randomUUID();
 * const job = await dispatchGarciaResearch(env, args, requestId);
 * persistJob({ requestId, status: "queued", topic: args.topic, createdAt: new Date().toISOString() });
 * return { ...job, status: "queued", message: "Research job accepted; poll its status." };
 *
 * Do not block the /ai-chat request until GitHub Actions completes. The existing
 * D1 agent-job store or a dedicated research_jobs table can persist status.
 */
