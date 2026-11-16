export const CIBA_TOOL_PROPOSAL_PREFIX = "CIBA_TOOL_CALL_V1\n";
const MAX_PROPOSAL_BYTES = 64_000;
export interface CibaToolModelProposal { toolId: string; input: Record<string, unknown>; }
/** Parses a proposal only; authorization and execution are separate operations. */
export function parseCibaToolModelProposal(value: unknown): CibaToolModelProposal | null {
  if (typeof value !== "string" || !value.startsWith(CIBA_TOOL_PROPOSAL_PREFIX)) return null;
  const payload = value.slice(CIBA_TOOL_PROPOSAL_PREFIX.length);
  if (!payload.trim() || new TextEncoder().encode(payload).byteLength > MAX_PROPOSAL_BYTES) throw new Error("invalid_tool_proposal");
  let parsed: unknown;
  try { parsed = JSON.parse(payload); } catch { throw new Error("invalid_tool_proposal"); }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed) || Object.getPrototypeOf(parsed) !== Object.prototype) throw new Error("invalid_tool_proposal");
  const descriptors = Object.getOwnPropertyDescriptors(parsed);
  const keys = Reflect.ownKeys(descriptors);
  const allowed = new Set(["protocol", "toolId", "input"]);
  if (keys.length !== allowed.size || keys.some((key) => typeof key !== "string" || !allowed.has(key))) throw new Error("invalid_tool_proposal");
  const fields: Record<string, unknown> = Object.create(null);
  for (const key of keys as string[]) { const descriptor = descriptors[key]; if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new Error("invalid_tool_proposal"); fields[key] = descriptor.value; }
  if (fields.protocol !== "ciba.tool.proposal.v1" || typeof fields.toolId !== "string" || fields.toolId.length > 64 || !/^[a-z][a-z0-9._-]{0,63}$/.test(fields.toolId) || fields.input === null || typeof fields.input !== "object" || Array.isArray(fields.input) || Object.getPrototypeOf(fields.input) !== Object.prototype) throw new Error("invalid_tool_proposal");
  return Object.freeze({ toolId: fields.toolId, input: fields.input as Record<string, unknown> });
}