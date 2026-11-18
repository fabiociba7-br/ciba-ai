import type { OrchestrationResult } from "../types";
import { MAX_MODEL_ID_CHARS } from "./input-types";

export function snapshotProviderResult(value: unknown): Pick<OrchestrationResult, "text" | "raw" | "provider" | "model"> {
  try {
    const fields = readPlainRecord(value, ["text", "raw", "provider", "model"]);
    const { text, raw, provider, model } = fields;
    if (typeof text !== "string" || text.length > 1_000_000 ||
        typeof provider !== "string" || provider.length > 128 ||
        typeof model !== "string" || model.length > MAX_MODEL_ID_CHARS) {
      throw new Error("invalid_provider_result");
    }
    // Raw provider payloads are intentionally not propagated across the public boundary.
    const safeRaw = raw === null || ["string", "number", "boolean", "undefined"].includes(typeof raw)
      ? raw
      : undefined;
    return Object.freeze({ text, raw: safeRaw, provider, model });
  } catch {
    throw new Error("invalid_provider_result");
  }
}
