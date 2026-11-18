import type { ChatTurn, ModelProvider } from "../types";
import type { CibaToolInvocationContext, ExecutableCibaToolRegistry } from "../tools/registry";
import type { DurableCibaToolApprovalFlow } from "../tools/durable-approval-flow";
import type { DurableToolApprovalIdentity } from "../tools/durable-consent";
import { MAX_MESSAGES, MAX_MESSAGE_CHARS, MAX_MEMORY_CONTEXT_CHARS, MAX_MODEL_ID_CHARS, MAX_OUTPUT_TOKENS, type OrchestratorInput } from "./input-types";
import { readPlainRecord } from "./input-validation";

function snapshotArray(value: unknown, maxLength: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length === 0 || value.length > maxLength) throw new Error("invalid_orchestration_message");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== value.length + 1) throw new Error("invalid_orchestration_message");
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error("invalid_orchestration_message");
    }
    result.push(descriptor.value);
  }
  return result;
}

function snapshotChatMessages(value: unknown): ChatTurn[] {
  try {
    return snapshotArray(value, MAX_MESSAGES).map((entry) => {
      const fields = readPlainRecord(entry, ["role", "content"]);
      const role = fields.role;
      const content = fields.content;
      if ((role !== "user" && role !== "assistant") ||
          typeof content !== "string" || content.length > MAX_MESSAGE_CHARS) {
        throw new Error("invalid_orchestration_message");
      }
      return Object.freeze({ role, content }) as ChatTurn;
    });
  } catch {
    throw new Error("invalid_orchestration_message");
  }
}

function snapshotProvider(value: unknown): ModelProvider {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("invalid_orchestration_request");
    }
    const own = Object.getOwnPropertyDescriptors(value);
    const idDescriptor = own.id;
    const enabledDescriptor = own.enabled;
    if (!idDescriptor || !("value" in idDescriptor) || !idDescriptor.enumerable ||
        !enabledDescriptor || !("value" in enabledDescriptor) || !enabledDescriptor.enumerable) {
      throw new Error("invalid_orchestration_request");
    }
    let generateDescriptor: PropertyDescriptor | undefined = own.generate;
    if (!generateDescriptor) {
      const prototype = Object.getPrototypeOf(value);
      if (prototype && prototype !== Object.prototype) {
        generateDescriptor = Object.getOwnPropertyDescriptor(prototype, "generate");
      }
    }
    const id = idDescriptor.value;
    const enabled = enabledDescriptor.value;
    const generate = generateDescriptor && "value" in generateDescriptor
      ? generateDescriptor.value
      : undefined;
    if (typeof id !== "string" || !id.trim() || id.length > 128 ||
        enabled !== true || typeof generate !== "function") {
      throw new Error("invalid_orchestration_request");
    }
    return Object.freeze({
      id,
      enabled: true,
      generate: (request: Parameters<ModelProvider["generate"]>[0]) =>
        generate.call(value, request) as ReturnType<ModelProvider["generate"]>
    });
  } catch {
    throw new Error("invalid_orchestration_request");
  }
}

function snapshotToolRuntime(value: unknown): {
  registry: ExecutableCibaToolRegistry;
  context: CibaToolInvocationContext;
  durableApproval?: { flow: DurableCibaToolApprovalFlow; identity: DurableToolApprovalIdentity };
  executeReadOnlyProposals?: boolean;
} {
  const fields = readPlainRecord(value, ["registry", "context", "durableApproval", "executeReadOnlyProposals"], ["registry", "context"]);
  const registryFields = readPlainRecord(fields.registry, ["get", "list", "describe", "prepare", "execute"]);
  if (Object.values(registryFields).some((method) => typeof method !== "function")) throw new Error("invalid_tool_runtime");
  const registry = fields.registry as ExecutableCibaToolRegistry;
  const contextFields = readPlainRecord(fields.context, ["conversationId", "invocationId"]);
  if (typeof contextFields.conversationId !== "string" || !contextFields.conversationId.trim() || contextFields.conversationId.length > 128 ||
      typeof contextFields.invocationId !== "string" || !contextFields.invocationId.trim() || contextFields.invocationId.length > 128) throw new Error("invalid_tool_runtime");

  if (fields.executeReadOnlyProposals !== undefined && typeof fields.executeReadOnlyProposals !== "boolean") {
    throw new Error("invalid_tool_runtime");
  }
  const executeReadOnlyProposals = fields.executeReadOnlyProposals === true;

  let durableApproval: { flow: DurableCibaToolApprovalFlow; identity: DurableToolApprovalIdentity } | undefined;
  if (fields.durableApproval !== undefined) {
    const durableFields = readPlainRecord(fields.durableApproval, ["flow", "identity"]);
    const flowFields = readPlainRecord(durableFields.flow, ["registry", "propose", "answer", "execute", "cancel"]);
    if (flowFields.registry !== registry ||
        ["propose", "answer", "execute", "cancel"].some((key) => typeof flowFields[key] !== "function")) {
      throw new Error("invalid_tool_runtime");
    }
    const identity = readPlainRecord(durableFields.identity, ["ownerId", "appId", "deviceId"]);
    if (typeof identity.ownerId !== "string" || !identity.ownerId.trim() ||
        typeof identity.appId !== "string" || !identity.appId.trim() ||
        typeof identity.deviceId !== "string" || !identity.deviceId.trim()) {
      throw new Error("invalid_tool_runtime");
    }
    durableApproval = Object.freeze({
      flow: durableFields.flow as DurableCibaToolApprovalFlow,
      identity: Object.freeze({
        ownerId: identity.ownerId,
        appId: identity.appId,
        deviceId: identity.deviceId
      })
    });
  }
  return Object.freeze({
    registry,
    context: Object.freeze({
      conversationId: contextFields.conversationId,
      invocationId: contextFields.invocationId
    }),
    ...(durableApproval ? { durableApproval } : {}),
    ...(executeReadOnlyProposals ? { executeReadOnlyProposals: true } : {})
  });
}

function snapshotInput(value: unknown): {
  messages: ChatTurn[];
  model: string;
  maxOutputTokens: number;
  provider: ModelProvider;
  memoryContext?: string;
  toolRuntime?: {
  registry: ExecutableCibaToolRegistry;
  context: CibaToolInvocationContext;
  durableApproval?: { flow: DurableCibaToolApprovalFlow; identity: DurableToolApprovalIdentity };
  executeReadOnlyProposals?: boolean;
};
} {
  const fields = readPlainRecord(
    value,
    ["messages", "model", "maxOutputTokens", "provider", "memoryContext", "toolRuntime"],
    ["messages", "model", "maxOutputTokens", "provider"]
  );
  const messages = snapshotChatMessages(fields.messages);
  const provider = snapshotProvider(fields.provider);
  const model = fields.model;
  const maxOutputTokens = fields.maxOutputTokens;
  const memoryContext = fields.memoryContext;
  const toolRuntime = fields.toolRuntime === undefined ? undefined : snapshotToolRuntime(fields.toolRuntime);
  if (typeof model !== "string" || !model.trim() || model.length > MAX_MODEL_ID_CHARS ||
      !Number.isInteger(maxOutputTokens) || (maxOutputTokens as number) < 1 ||
      (maxOutputTokens as number) > MAX_OUTPUT_TOKENS ||
      (memoryContext !== undefined &&
        (typeof memoryContext !== "string" || memoryContext.length > MAX_MEMORY_CONTEXT_CHARS))) {
    throw new Error("invalid_orchestration_request");
  }
  return Object.freeze({
    messages,
    model,
    maxOutputTokens: maxOutputTokens as number,
    provider,
    ...(memoryContext === undefined ? {} : { memoryContext: memoryContext as string }),
    ...(toolRuntime === undefined ? {} : { toolRuntime })
  });
}

export { type OrchestratorInput };
