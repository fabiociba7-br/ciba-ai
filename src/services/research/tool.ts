import type { CibaToolDefinition } from "../../core/tools/contracts";
import { GarciaResearchService } from "./service";
import type { ResearchEnv, ResearchToolInput } from "./types";
export const GARCIA_RESEARCH_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    topic: { type: "string", minLength: 3, maxLength: 300 },
    depth: { type: "string", enum: ["quick", "standard", "deep"] },
    focus: { type: "array", items: { type: "string", minLength: 1, maxLength: 80 }, maxItems: 8 },
    visual_mode: { type: "boolean" },
    mode: { type: "string", enum: ["generate", "search"] },
    session_id: { type: "string", minLength: 36, maxLength: 36 },
    feedback: { type: "string", minLength: 1, maxLength: 1200 },
  },
  additionalProperties: false,
  required: ["topic"],
};
export function createGarciaResearchTool(env: ResearchEnv): CibaToolDefinition {
  return {
    id: "garcia.research",
    description: "Pesquisa e sintetiza tópicos técnicos, salva relatórios no R2 ou cria/refina imagens no Estúdio Visual. Para uma criação nova use visual_mode=true e mode=generate ou search. Para iterar uma criação anterior, reutilize session_id e envie feedback; a sessão é privada do proprietário autenticado.",
    risk: "external", requiresApproval: true, inputSchema: GARCIA_RESEARCH_INPUT_SCHEMA,
    async execute(input) { return new GarciaResearchService(env).research(input as ResearchToolInput); },
  };
}
