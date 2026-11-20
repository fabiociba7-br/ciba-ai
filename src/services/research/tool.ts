import type { CibaToolDefinition } from "../../core/tools/contracts";
import { GarciaResearchService } from "./service";
import type { ResearchEnv, ResearchToolInput } from "./types";
export const GARCIA_RESEARCH_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    topic: { type: "string", minLength: 3, maxLength: 300 },
    depth: { type: "string", enum: ["quick", "standard", "deep"] },
    focus: { type: "array", items: { type: "string", minLength: 1, maxLength: 80 }, maxItems: 8 },
  },
  required: ["topic"], additionalProperties: false,
};
export function createGarciaResearchTool(env: ResearchEnv): CibaToolDefinition<ResearchToolInput, unknown> {
  return {
    id: "garcia.research",
    description: "Pesquisa um tópico técnico no DuckDuckGo, sintetiza evidências com Workers AI e publica um relatório no GitHub quando configurado. Exige aprovação porque pode criar um commit remoto.",
    risk: "external", requiresApproval: true, inputSchema: GARCIA_RESEARCH_INPUT_SCHEMA,
    async execute(input) { return new GarciaResearchService(env).research(input); },
  };
}
