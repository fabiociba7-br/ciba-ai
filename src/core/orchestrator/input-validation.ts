import type { OrchestratorInput } from "./input-types";
import { MAX_TOTAL_INPUT_BYTES } from "./input-types";

export function readPlainRecord(value: unknown, allowedKeys: string[], requiredKeys = allowedKeys): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) throw new Error("invalid_orchestration_request");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string" || !allowedKeys.includes(key)) ||
      requiredKeys.some((key) => !Object.prototype.hasOwnProperty.call(descriptors, key))) {
    throw new Error("invalid_orchestration_request");
  }
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error("invalid_orchestration_request");
    }
    result[key] = descriptor.value;
  }
  return result;
}

export function validateInput(input: OrchestratorInput): void {
  let totalCharacters = 0;
  let hasUserMessage = false;
  for (const message of input.messages) {
    if (message.role === "user") hasUserMessage = true;
    totalCharacters += message.content.length;
  }
  if (!hasUserMessage) throw new Error("user_message_required");

  const requestBytes = new TextEncoder().encode(JSON.stringify({
    model: input.model,
    messages: input.messages,
    memoryContext: input.memoryContext ?? "",
    maxOutputTokens: input.maxOutputTokens
  })).byteLength;
  if (requestBytes > MAX_TOTAL_INPUT_BYTES || totalCharacters > MAX_TOTAL_INPUT_BYTES) {
    throw new Error("orchestration_input_too_large");
  }
}
