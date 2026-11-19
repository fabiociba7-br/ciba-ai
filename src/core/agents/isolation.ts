import type { CibaRole, ChatTurn } from "./types";
import type { CibaToolModelDescriptor } from "./tools/contracts";

export interface AgentIsolationPolicy {
  maxContextChars: number;
  maxContextMessages: number;
  maxToolDescriptors: number;
  allowedToolRisks: readonly ("read" | "write" | "external")[];
}

const POLICIES: Record<CibaRole, AgentIsolationPolicy> = {
  general: { maxContextChars: 12_000, maxContextMessages: 24, maxToolDescriptors: 8, allowedToolRisks: ["read"] },
  reasoning: { maxContextChars: 16_000, maxContextMessages: 32, maxToolDescriptors: 8, allowedToolRisks: ["read"] },
  research: { maxContextChars: 12_000, maxContextMessages: 24, maxToolDescriptors: 8, allowedToolRisks: ["read", "external"] },
  coding: { maxContextChars: 24_000, maxContextMessages: 32, maxToolDescriptors: 16, allowedToolRisks: ["read", "write", "external"] },
  creative: { maxContextChars: 8_000, maxContextMessages: 16, maxToolDescriptors: 4, allowedToolRisks: ["read"] },
  verification: { maxContextChars: 16_000, maxContextMessages: 24, maxToolDescriptors: 8, allowedToolRisks: ["read"] },
};

export function getAgentIsolationPolicy(role: CibaRole): AgentIsolationPolicy {
  return POLICIES[role];
}

/** Keeps the newest conversation turns within the specialist's private context budget. */
export function isolateAgentContext(role: CibaRole, messages: ChatTurn[]): ChatTurn[] {
  const policy = getAgentIsolationPolicy(role);
  const selected: ChatTurn[] = [];
  let chars = 0;
  for (let index = messages.length - 1; index >= 0 && selected.length < policy.maxContextMessages; index -= 1) {
    const message = messages[index];
    const remaining = policy.maxContextChars - chars;
    if (remaining <= 0) break;
    const content = message.content.length <= remaining ? message.content : message.content.slice(-remaining);
    selected.unshift(Object.freeze({ role: message.role, content }));
    chars += content.length;
  }
  return selected;
}

/** Risk filtering is a discovery boundary only; the registry still enforces authorization and approvals. */
export function isolateAgentTools(
  role: CibaRole,
  descriptors: CibaToolModelDescriptor[]
): CibaToolModelDescriptor[] {
  const policy = getAgentIsolationPolicy(role);
  return descriptors
    .filter((descriptor) => policy.allowedToolRisks.includes(descriptor.risk))
    .slice(0, policy.maxToolDescriptors);
}
