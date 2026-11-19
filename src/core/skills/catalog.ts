import type { CibaRole, ChatTurn } from "../types";

export interface GarciaSkillDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  roles: readonly CibaRole[];
  triggers: readonly string[];
  priority: number;
  instructions: string;
}

export interface GarciaSkillSummary {
  id: string;
  name: string;
  description: string;
  version: string;
  roles: CibaRole[];
}

const ROLE_DEFAULT_SKILL: Record<CibaRole, string> = {
  general: "task-planning",
  reasoning: "task-planning",
  research: "research-synthesis",
  coding: "software-engineering",
  creative: "technical-writing",
  verification: "repository-audit",
};

const SKILLS: readonly GarciaSkillDefinition[] = Object.freeze([
  {
    id: "task-planning",
    name: "Planejamento de tarefas",
    description: "Transforma objetivos em etapas pequenas, dependências e critérios verificáveis.",
    version: "1.0.0",
    roles: ["general", "reasoning"],
    triggers: ["planejar", "plano", "etapas", "roadmap", "organizar", "priorizar", "cronograma"],
    priority: 80,
    instructions: "Defina o resultado esperado, restrições e critérios de conclusão. Divida o trabalho em etapas ordenadas, identifique dependências e riscos. Prefira a próxima ação concreta; não declare uma etapa concluída sem evidência.",
  },
  {
    id: "research-synthesis",
    name: "Pesquisa e síntese",
    description: "Organiza evidências, diferencia fatos de hipóteses e registra incertezas.",
    version: "1.0.0",
    roles: ["research", "reasoning"],
    triggers: ["pesquisar", "fontes", "evidências", "investigar", "comparar", "documentação", "referências"],
    priority: 70,
    instructions: "Separe fatos verificados, inferências e hipóteses. Priorize fontes primárias e atuais, registre a data e o escopo da evidência e não invente fontes, resultados ou compatibilidade. Quando houver conflito, descreva a divergência.",
  },
  {
    id: "software-engineering",
    name: "Engenharia de software",
    description: "Implementa mudanças pequenas, testáveis e compatíveis com a arquitetura existente.",
    version: "1.0.0",
    roles: ["coding"],
    triggers: ["código", "programar", "implementar", "corrigir", "bug", "refatorar", "api", "teste", "build", "compilar"],
    priority: 90,
    instructions: "Inspecione o fluxo e os contratos existentes antes de alterar. Faça mudanças mínimas e coesas, preserve compatibilidade e dados, valide entradas e falhas. Acrescente testes de regressão. Não gere APK, publique ou execute operações destrutivas sem autorização explícita.",
  },
  {
    id: "repository-audit",
    name: "Auditoria de repositório",
    description: "Revisa arquitetura, segurança, permissões, dependências e evidências de validação.",
    version: "1.0.0",
    roles: ["verification", "coding"],
    triggers: ["auditar", "revisar código", "segurança", "risco", "conferir", "validar", "repositório", "permissões"],
    priority: 100,
    instructions: "Verifique o código real, os pontos de entrada, limites de confiança e testes. Procure bypass de autorização, exposição de segredos, SSRF, concorrência, limites e falhas de rollback. Diferencie código presente, testes executados, deploy e comportamento observado. Não altere arquivos quando a tarefa for somente auditoria.",
  },
  {
    id: "technical-writing",
    name: "Documentação técnica",
    description: "Produz documentação operacional fiel aos contratos e limitações reais.",
    version: "1.0.0",
    roles: ["creative", "general"],
    triggers: ["documentar", "documentação", "escrever", "redigir", "readme", "manual", "especificação"],
    priority: 60,
    instructions: "Escreva para quem precisa operar ou manter o sistema. Inclua pré-requisitos, passos reproduzíveis, contratos, limites, segurança e exemplos mínimos. Não documente como disponível algo que esteja apenas planejado; marque claramente o que ainda não foi conectado ou validado.",
  },
]);

const MAX_ACTIVE_SKILLS = 2;
const MAX_SKILL_INSTRUCTION_CHARS = 4_000;

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function listGarciaSkills(): GarciaSkillSummary[] {
  return SKILLS.map(({ id, name, description, version, roles }) => ({
    id, name, description, version, roles: [...roles],
  }));
}

export function getGarciaSkill(skillId: string): GarciaSkillDefinition | undefined {
  return SKILLS.find((skill) => skill.id === skillId);
}

/** Selects built-in declarative guidance only; it never grants tools or execution permissions. */
export function selectGarciaSkills(role: CibaRole, messages: ChatTurn[]): GarciaSkillDefinition[] {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  const normalized = normalize(latestUserMessage);
  const applicable = SKILLS.filter((skill) => skill.roles.includes(role));
  const defaultSkill = getGarciaSkill(ROLE_DEFAULT_SKILL[role]);
  const selected: GarciaSkillDefinition[] = defaultSkill && defaultSkill.roles.includes(role) ? [defaultSkill] : [];

  const ranked = applicable
    .filter((skill) => !selected.some((item) => item.id === skill.id))
    .map((skill) => ({
      skill,
      score: skill.triggers.reduce((total, trigger) => total + (normalized.includes(normalize(trigger)) ? 1 : 0), 0),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.skill.priority - a.skill.priority);

  for (const item of ranked) {
    if (selected.length >= MAX_ACTIVE_SKILLS) break;
    selected.push(item.skill);
  }
  return selected.slice(0, MAX_ACTIVE_SKILLS);
}

export function formatGarciaSkillInstructions(skills: readonly GarciaSkillDefinition[]): string {
  const unique = [...new Map(skills.map((skill) => [skill.id, getGarciaSkill(skill.id)]))
    .values()]
    .filter((skill): skill is GarciaSkillDefinition => Boolean(skill))
    .slice(0, MAX_ACTIVE_SKILLS);
  if (unique.length === 0) return "";
  const formatted = [
    "Skills internas ativas (orientações declarativas confiáveis; subordinadas à identidade, à solicitação atual e às políticas de autorização):",
    ...unique.map((skill) => `[${skill.id} · ${skill.name}]\n${skill.instructions}`),
  ].join("\n\n");
  return formatted.slice(0, MAX_SKILL_INSTRUCTION_CHARS);
}
