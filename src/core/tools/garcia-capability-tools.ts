import {
  createNativeCapabilityRegistry,
  type NativeCapabilityCategory,
} from "../native-capabilities";
import {
  createCibaToolRegistry,
  type CibaToolAuthorizationRequest,
  type CibaToolRegistryOptions,
  type ExecutableCibaToolRegistry,
} from "./registry";

const CATEGORIES: NativeCapabilityCategory[] = [
  "image_generation",
  "video_generation",
  "speech_to_text",
  "text_to_speech",
  "voice_conversion",
  "vision",
  "document_understanding",
  "coding",
  "audio_generation",
  "agent_orchestration",
];

const LIST_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    category: { type: "string", enum: CATEGORIES },
  },
  additionalProperties: false,
};

const GET_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    capabilityId: { type: "string", minLength: 1, maxLength: 64 },
  },
  required: ["capabilityId"],
  additionalProperties: false,
};

export type GarciaCapabilityToolAuthorizer = CibaToolRegistryOptions["authorize"];

export interface GarciaCapabilityToolOptions {
  /** Trusted application policy; must enforce the caller's read access. */
  authorize: GarciaCapabilityToolAuthorizer;
}

/**
 * Creates Garcia's first read-only native-capability tools.
 *
 * The catalog contains metadata only. These tools cannot install models,
 * download weights, invoke adapters, change capability status, or perform
 * external requests. The explicit allowlist keeps them disabled unless a
 * trusted caller deliberately includes their IDs.
 */
export function createGarciaCapabilityTools(
  options: GarciaCapabilityToolOptions
): ExecutableCibaToolRegistry {
  if (!options || typeof options.authorize !== "function") {
    throw new Error("garcia_capability_authorizer_required");
  }
  const catalog = createNativeCapabilityRegistry();

  return createCibaToolRegistry([
    {
      id: "garcia.capabilities.list",
      description: "Lista capacidades nativas catalogadas pela Garcia, com status, runtime, licença e requisitos.",
      risk: "read",
      requiresApproval: false,
      inputSchema: LIST_SCHEMA,
      async execute(input) {
        const category = (input as { category?: NativeCapabilityCategory }).category;
        return category ? catalog.listByCategory(category) : catalog.list();
      },
    },
    {
      id: "garcia.capabilities.get",
      description: "Consulta os metadados de uma capacidade nativa da Garcia pelo identificador.",
      risk: "read",
      requiresApproval: false,
      inputSchema: GET_SCHEMA,
      async execute(input) {
        const capabilityId = (input as { capabilityId: string }).capabilityId;
        const capability = catalog.get(capabilityId);
        return capability ? { found: true, capability } : { found: false };
      },
    },
  ], {
    allowlist: ["garcia.capabilities.list", "garcia.capabilities.get"],
    authorize: options.authorize,
    timeoutMs: 5_000,
    maxInputBytes: 2_048,
    maxOutputBytes: 64_000,
    maxConcurrentExecutions: 4,
  });
}
