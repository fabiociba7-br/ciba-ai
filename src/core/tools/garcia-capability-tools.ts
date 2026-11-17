import type { CibaToolDefinition } from "./contracts";
import {
  createNativeCapabilityRegistry,
  type NativeCapabilityCategory,
} from "../native-capabilities";
import {
  createCibaToolRegistry,
  type CibaToolInvocationContext,
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
  /** Optional owner-scoped Facebook connection status reader supplied by the trusted backend. */
  getFacebookConnectionStatus?: () => Promise<{ linked: boolean; linkedAt: string | null }>;
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

  const definitions: CibaToolDefinition[] = [
    {
      id: "garcia.capabilities.list",
      description: "Lista capacidades nativas da Garcia com status, licença, runtime e prontidão real do adaptador.",
      risk: "read",
      requiresApproval: false,
      inputSchema: LIST_SCHEMA,
      async execute(input) {
        const category = (input as { category?: NativeCapabilityCategory }).category;
        const capabilities = category ? catalog.listByCategory(category) : catalog.list();
        return capabilities.map((capability) => ({
          ...capability,
          readiness: catalog.getReadiness(capability.id),
        }));
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
        return capability
          ? { found: true, capability, readiness: catalog.getReadiness(capabilityId) }
          : { found: false };
      },
    },
    ...(options.getFacebookConnectionStatus ? [{
      id: "facebook.connection.status",
      description: "Consulta se a conta do proprietário desta sessão está vinculada ao Facebook. Não consulta publicações, mensagens ou páginas.",
      risk: "read" as const,
      requiresApproval: false,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      async execute() {
        const status = await options.getFacebookConnectionStatus!();
        return {
          provider: "facebook",
          linked: status.linked,
          linked_at: status.linkedAt,
          available_operations: ["connection_status"],
          unavailable_operations: ["profile", "posts", "pages", "messages"],
          limitation: "O token de acesso do Facebook não é armazenado pelo backend; consultas de dados ainda não estão habilitadas.",
        };
      },
    }] : []),
  ];
  return createCibaToolRegistry(definitions, {
    allowlist: [
      "garcia.capabilities.list",
      "garcia.capabilities.get",
      ...(options.getFacebookConnectionStatus ? ["facebook.connection.status"] : []),
    ],
    authorize: options.authorize,
    timeoutMs: 5_000,
    maxInputBytes: 2_048,
    maxOutputBytes: 64_000,
    maxConcurrentExecutions: 4,
  });
}

export interface GarciaCapabilityToolRuntimeOptions extends GarciaCapabilityToolOptions {
  context: CibaToolInvocationContext;
  /** Defaults to false. Set true only in a trusted application runtime. */
  executeReadOnlyProposals?: boolean;
}

export interface GarciaCapabilityToolRuntime {
  registry: ExecutableCibaToolRegistry;
  context: CibaToolInvocationContext;
  executeReadOnlyProposals: boolean;
}

/** Builds the exact runtime shape accepted by runCibaOrchestrator. */
export function createGarciaCapabilityToolRuntime(
  options: GarciaCapabilityToolRuntimeOptions
): GarciaCapabilityToolRuntime {
  if (!options || typeof options.authorize !== "function") {
    throw new Error("garcia_capability_authorizer_required");
  }
  if (options.executeReadOnlyProposals !== undefined &&
      typeof options.executeReadOnlyProposals !== "boolean") {
    throw new Error("invalid_garcia_capability_runtime");
  }
  const rawContext = options.context;
  if (rawContext === null || typeof rawContext !== "object" || Array.isArray(rawContext) ||
      Object.getPrototypeOf(rawContext) !== Object.prototype) {
    throw new Error("invalid_garcia_capability_runtime");
  }
  const descriptors = Object.getOwnPropertyDescriptors(rawContext);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== 2 || !descriptors.conversationId ||
      !("value" in descriptors.conversationId) || !descriptors.conversationId.enumerable ||
      !descriptors.invocationId || !("value" in descriptors.invocationId) ||
      !descriptors.invocationId.enumerable ||
      typeof descriptors.conversationId.value !== "string" ||
      !descriptors.conversationId.value.trim() || descriptors.conversationId.value.length > 128 ||
      typeof descriptors.invocationId.value !== "string" ||
      !descriptors.invocationId.value.trim() || descriptors.invocationId.value.length > 128) {
    throw new Error("invalid_garcia_capability_runtime");
  }
  return Object.freeze({
    registry: createGarciaCapabilityTools({
      authorize: options.authorize,
      getFacebookConnectionStatus: options.getFacebookConnectionStatus,
    }),
    context: Object.freeze({
      conversationId: descriptors.conversationId.value,
      invocationId: descriptors.invocationId.value,
    }),
    executeReadOnlyProposals: options.executeReadOnlyProposals === true,
  });
}
