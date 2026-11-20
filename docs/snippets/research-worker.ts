/**
 * Reference integration for the Garcia Cloudflare Worker.
 *
 * This follows ciba-ai's existing CibaToolDefinition/additionalTools registry
 * contract. The tool is classified as external and requires the existing
 * durable approval flow before dispatching an external research job.
 *
 * Bind GITHUB_RESEARCH_TOKEN as a Worker secret (Actions: write; Contents:
 * write only if the workflow is allowed to commit). Never expose it to clients.
 */
import type { CibaToolDefinition } from "../../src/core/tools/contracts";

export interface ResearchJobEnv {
  GITHUB_RESEARCH_TOKEN: string;
  GITHUB_REPOSITORY: string; // owner/repo
  GITHUB_RESEARCH_WORKFLOW?: string; // research-job.yml
  GITHUB_RESEARCH_REF?: string; // feat/garcia-research-package
}

type ResearchDepth = "quick" | "standard" | "deep";
type ResearchToolArgs = { topic: string; depth?: ResearchDepth; focus?: string[] };

const GH_API = "https://api.github.com";

const GARCIA_RESEARCH_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    topic: { type: "string", minLength: 3, maxLength: 300 },
    depth: { type: "string", enum: ["quick", "standard", "deep"] },
    focus: {
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 80 },
      maxItems: 8,
    },
  },
  required: ["topic"],
  additionalProperties: false,
};

export async function dispatchGarciaResearch(
  env: ResearchJobEnv,
  args: ResearchToolArgs,
  requestId: string,
): Promise<{ accepted: true; request_id: string; status: "queued" }> {
  const topic = args.topic.trim();
  if (topic.length < 3 || topic.length > 300) throw new Error("invalid_research_topic");
  const focus = (args.focus || []).slice(0, 8).map((v) => v.trim()).filter(Boolean);
  const response = await fetch(
    \`\${GH_API}/repos/\${env.GITHUB_REPOSITORY}/actions/workflows/\${env.GITHUB_RESEARCH_WORKFLOW || "research-job.yml"}/dispatches\`,
    {
      method: "POST",
      headers: {
        Authorization: \`Bearer \${env.GITHUB_RESEARCH_TOKEN}\`,
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
    throw new Error(\`research_dispatch_failed_http_\${response.status}\`);
  }
  return { accepted: true, request_id: requestId, status: "queued" };
}

/** Register this definition in createGarciaCapabilityToolRuntime({additionalTools}). */
export function createGarciaResearchTool(env: ResearchJobEnv): CibaToolDefinition<
  ResearchToolArgs,
  { accepted: true; request_id: string; status: "queued" }
> {
  return {
    id: "garcia_research",
    description: "Pesquisa um tópico técnico/de segurança e retorna um identificador de Job para consultar o relatório. A execução externa exige aprovação.",
    risk: "external",
    requiresApproval: true,
    inputSchema: GARCIA_RESEARCH_SCHEMA,
    async execute(input) {
      return dispatchGarciaResearch(env, input, crypto.randomUUID());
    },
  };
}

/*
 * Existing runtime registration inside handleChat (reference):
 *
 * const researchTool = createGarciaResearchTool(env);
 * const toolRuntime = owner && await isAppAllowed(env, device.app_id)
 *   ? createGarciaCapabilityToolRuntime({
 *       ...existingRuntimeOptions,
 *       additionalTools: [...composioChatTools, researchTool],
 *       authorize: async (toolRequest) => {
 *         if (toolRequest.toolId === "garcia_research") {
 *           return Boolean(env.GITHUB_RESEARCH_TOKEN) &&
 *             device.owner_id === owner.owner_id;
 *         }
 *         return existingAuthorize(toolRequest);
 *       },
 *     })
 *   : undefined;
 *
 * The schema is then exposed through the existing registry's describe() output
 * to runCibaOrchestrator. The LLM can propose the tool; the current durable
 * approval flow controls execution. Do not bypass that approval with a direct
 * fetch from user-controlled request data.
 *
 * Dispatch returns HTTP 202 semantics (queued) rather than waiting for Python.
 * Persist request_id in D1/a durable job store and add a status route that
 * finds the workflow run by its run-name correlation ID, then retrieves its
 * garcia-research-report artifact when completed. GitHub workflow_dispatch
 * returns 204 without a run ID, so the Worker must correlate asynchronously.
 */
