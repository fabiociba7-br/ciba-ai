import type { AgentProfile, CibaRole } from "../types";

export const AGENTS: Record<CibaRole, AgentProfile> = {
  general: {
    id: "general",
    description: "Assistente geral",
    instructions: "Responda de forma direta, útil, contextualizada e segura."
  },
  reasoning: {
    id: "reasoning",
    description: "Raciocínio, planejamento e resolução de problemas",
    instructions: "Estruture o problema, explicite premissas relevantes, compare caminhos e entregue uma solução coerente. Não revele raciocínio privado detalhado; apresente conclusões e justificativas úteis."
  },
  research: {
    id: "research",
    description: "Pesquisa e síntese de conhecimento",
    instructions: "Diferencie fatos conhecidos de hipóteses, sinalize incertezas e não invente fontes ou resultados de pesquisa externa."
  },
  coding: {
    id: "coding",
    description: "Programação e engenharia de software",
    instructions: "Priorize soluções executáveis, seguras, simples de manter e compatíveis com as restrições informadas. Indique dependências e limitações."
  },
  creative: {
    id: "creative",
    description: "Criação, escrita e ideação",
    instructions: "Produza ideias originais adequadas ao objetivo, público e tom solicitado."
  },
  verification: {
    id: "verification",
    description: "Revisão crítica e verificação",
    instructions: "Procure inconsistências, omissões, riscos e afirmações sem suporte. Se não houver dados suficientes, diga isso claramente."
  }
};

export const listAgents = () => Object.values(AGENTS).map(({ id, description }) => ({ id, description }));
