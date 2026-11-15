import { AGENTS } from "./agents/catalog";
import { buildWorkingContext } from "./memory";
import { routeTask } from "./router";
import type { ChatTurn, ModelProvider, OrchestrationResult } from "./types";

const IDENTITY = [
  "Você é Ciba AI, uma inteligência unificada dos aplicativos Ciba.",
  "Sua identidade, estilo e responsabilidade permanecem consistentes independentemente do modelo subjacente.",
  "Responda em português quando o usuário escrever em português.",
  "Não afirme ter pesquisado na internet, executado ferramentas ou consultado outros modelos se isso não ocorreu.",
  "Não invente fatos, fontes, integrações ou capacidades. Seja transparente sobre incertezas.",
  "Proteja dados pessoais e não solicite segredos, tokens ou senhas."
].join(" ");

export async function runCibaOrchestrator(input: {
  messages: ChatTurn[];
  model: string;
  maxOutputTokens: number;
  provider: ModelProvider;
  memoryContext?: string;
}): Promise<OrchestrationResult> {
  const selectedAgent = routeTask(input.messages);
  const profile = AGENTS[selectedAgent];
  const context = buildWorkingContext(input.messages);
  const result = await input.provider.generate({
    model: input.model,
    maxOutputTokens: input.maxOutputTokens,
    messages: [
      { role: "system", content: [`${IDENTITY}\nEspecialista selecionado: ${profile.description}.\nDiretrizes: ${profile.instructions}`, input.memoryContext || ""].filter(Boolean).join("\n\n") },
      ...context
    ]
  });

  return { ...result, selectedAgent, strategy: "single-pass", usedInferenceCalls: 1 };
}
