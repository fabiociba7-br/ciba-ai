import type { CibaRole, ChatTurn } from "./types";

/**
 * Deterministic, zero-extra-inference task routing.
 * This selects an expert instruction profile, not a separate model.
 */
export function routeTask(messages: ChatTurn[]): CibaRole {
  const text = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n").toLowerCase();
  if (/\b(código|codigo|programar|programação|programacao|typescript|javascript|python|bug|api|deploy|github|sql|regex)\b/.test(text)) return "coding";
  if (/\b(crie|criar|escreva|escrever|roteiro|história|historia|nome|slogan|design|ideia|criativo)\b/.test(text)) return "creative";
  if (/\b(pesquise|pesquisar|fontes|referências|referencias|compare|comparar|evidências|evidencias)\b/.test(text)) return "research";
  if (/\b(confira|verifique|audite|revisar|revisão|revisao|está correto|esta correto|erros|riscos)\b/.test(text)) return "verification";
  if (/\b(planeje|planejar|estratégia|estrategia|decida|decisão|decisao|passo a passo|resolva|resolver|analise|análise)\b/.test(text)) return "reasoning";
  return "general";
}
