export type NativeCapabilityCategory =
  | "image_generation"
  | "video_generation"
  | "speech_to_text"
  | "text_to_speech"
  | "voice_conversion"
  | "vision"
  | "document_understanding"
  | "coding"
  | "audio_generation"
  | "agent_orchestration";

export type NativeCapabilityRuntime =
  | "android_embedded"
  | "desktop_local"
  | "local_service"
  | "remote_service"
  | "cloudflare_worker";

export type NativeCapabilityStatus =
  | "planned"
  | "adapter_ready"
  | "available"
  | "disabled";

export type NativeCapabilityLicenseStatus =
  | "review_required"
  | "approved"
  | "restricted"
  | "rejected";

export interface NativeCapabilityDefinition {
  id: string;
  name: string;
  category: NativeCapabilityCategory;
  description: string;
  sourceRepositories: string[];
  licenseStatus: NativeCapabilityLicenseStatus;
  status: NativeCapabilityStatus;
  supportedRuntimes: NativeCapabilityRuntime[];
  preferredRuntime: NativeCapabilityRuntime;
  installPolicy: "on_demand" | "optional" | "bundled";
  zeroCostOnly: boolean;
  requiresGpu: boolean;
  minimumRamMb: number;
  modelWeightsBundled: false;
}

export interface NativeCapabilityAdapter {
  readonly capabilityId: string;
  readonly runtime: NativeCapabilityRuntime;
  execute(input: unknown): Promise<unknown>;
}

export interface NativeCapabilityRegistry {
  get(capabilityId: string): NativeCapabilityDefinition | undefined;
  list(): NativeCapabilityDefinition[];
  listByCategory(category: NativeCapabilityCategory): NativeCapabilityDefinition[];
  getAdapter(capabilityId: string): NativeCapabilityAdapter | undefined;
}

/**
 * Garcia's native capability catalog. This is metadata and adapter plumbing,
 * not a claim that upstream models are already installed or executable.
 * Model weights are deliberately never bundled in this source repository.
 */
export const GARCIA_NATIVE_CAPABILITIES: NativeCapabilityDefinition[] = [
  {
    id: "image_generation",
    name: "Geração e edição de imagens",
    category: "image_generation",
    description: "Geração, edição, inpainting, controle por pose e composição visual.",
    sourceRepositories: [
      "Comfy-Org/ComfyUI",
      "huggingface/diffusers",
      "black-forest-labs/flux",
      "lllyasviel/ControlNet",
    ],
    licenseStatus: "review_required",
    status: "planned",
    supportedRuntimes: ["desktop_local", "local_service", "remote_service"],
    preferredRuntime: "local_service",
    installPolicy: "on_demand",
    zeroCostOnly: true,
    requiresGpu: true,
    minimumRamMb: 8192,
    modelWeightsBundled: false,
  },
  {
    id: "video_generation",
    name: "Geração e edição de vídeos",
    category: "video_generation",
    description: "Geração de clipes a partir de texto ou imagem e animação.",
    sourceRepositories: [
      "Wan-Video/Wan2.2",
      "Lightricks/LTX-Video",
      "guoyww/AnimateDiff",
    ],
    licenseStatus: "review_required",
    status: "planned",
    supportedRuntimes: ["desktop_local", "local_service", "remote_service"],
    preferredRuntime: "remote_service",
    installPolicy: "on_demand",
    zeroCostOnly: true,
    requiresGpu: true,
    minimumRamMb: 16384,
    modelWeightsBundled: false,
  },
  {
    id: "speech_to_text",
    name: "Transcrição e reconhecimento de fala",
    category: "speech_to_text",
    description: "Transcrição multilíngue, timestamps e identificação de falantes.",
    sourceRepositories: [
      "openai/whisper",
      "SYSTRAN/faster-whisper",
      "ggml-org/whisper.cpp",
      "m-bain/whisperX",
      "pyannote/pyannote-audio",
    ],
    licenseStatus: "review_required",
    status: "planned",
    supportedRuntimes: ["android_embedded", "desktop_local", "local_service", "remote_service"],
    preferredRuntime: "android_embedded",
    installPolicy: "on_demand",
    zeroCostOnly: true,
    requiresGpu: false,
    minimumRamMb: 1024,
    modelWeightsBundled: false,
  },
  {
    id: "text_to_speech",
    name: "Síntese de voz",
    category: "text_to_speech",
    description: "Síntese de voz local para respostas faladas e leitura de conteúdo; sem provedores remotos.",
    sourceRepositories: [
      "resemble-ai/chatterbox",
      "OHF-Voice/piper1-gpl",
      "hexgrad/kokoro",
      "kyutai-labs/pocket-tts",
    ],
    licenseStatus: "review_required",
    status: "planned",
    supportedRuntimes: ["desktop_local", "android_embedded"],
    preferredRuntime: "desktop_local",
    installPolicy: "on_demand",
    zeroCostOnly: true,
    requiresGpu: false,
    minimumRamMb: 512,
    modelWeightsBundled: false,
  },
  {
    id: "voice_conversion",
    name: "Conversão e personalização de voz",
    category: "voice_conversion",
    description: "Conversão vocal e personalização mediante autorização do titular da voz.",
    sourceRepositories: [
      "resemble-ai/chatterbox",
      "SWivid/F5-TTS",
      "RVC-Project/Retrieval-based-Voice-Conversion-WebUI",
    ],
    licenseStatus: "review_required",
    status: "planned",
    supportedRuntimes: ["desktop_local", "local_service", "remote_service"],
    preferredRuntime: "local_service",
    installPolicy: "optional",
    zeroCostOnly: true,
    requiresGpu: true,
    minimumRamMb: 8192,
    modelWeightsBundled: false,
  },
  {
    id: "computer_vision",
    name: "Visão computacional",
    category: "vision",
    description: "Detecção, segmentação, rastreamento e interpretação visual.",
    sourceRepositories: [
      "ultralytics/ultralytics",
      "facebookresearch/sam2",
      "IDEA-Research/GroundingDINO",
      "google-ai-edge/mediapipe",
      "opencv/opencv",
    ],
    licenseStatus: "review_required",
    status: "planned",
    supportedRuntimes: ["android_embedded", "desktop_local", "local_service", "remote_service"],
    preferredRuntime: "android_embedded",
    installPolicy: "on_demand",
    zeroCostOnly: true,
    requiresGpu: false,
    minimumRamMb: 1024,
    modelWeightsBundled: false,
  },
  {
    id: "document_understanding",
    name: "Leitura e compreensão de documentos",
    category: "document_understanding",
    description: "OCR, extração de texto e estruturação de documentos e imagens.",
    sourceRepositories: [
      "PaddlePaddle/PaddleOCR",
      "docling-project/docling",
      "huggingface/transformers",
    ],
    licenseStatus: "review_required",
    status: "planned",
    supportedRuntimes: ["android_embedded", "desktop_local", "local_service", "remote_service"],
    preferredRuntime: "local_service",
    installPolicy: "on_demand",
    zeroCostOnly: true,
    requiresGpu: false,
    minimumRamMb: 2048,
    modelWeightsBundled: false,
  },
  {
    id: "coding_agent",
    name: "Programação e manutenção de projetos",
    category: "coding",
    description: "Leitura, criação, edição, testes e correção de código em ambiente isolado.",
    sourceRepositories: [
      "OpenHands/OpenHands",
      "anomalyco/opencode",
      "cline/cline",
      "SWE-agent/SWE-agent",
      "aider-ai/aider",
    ],
    licenseStatus: "review_required",
    status: "planned",
    supportedRuntimes: ["desktop_local", "local_service", "remote_service"],
    preferredRuntime: "local_service",
    installPolicy: "optional",
    zeroCostOnly: true,
    requiresGpu: false,
    minimumRamMb: 4096,
    modelWeightsBundled: false,
  },
  {
    id: "audio_generation",
    name: "Geração e processamento de áudio",
    category: "audio_generation",
    description: "Geração de áudio, separação de fontes e processamento musical.",
    sourceRepositories: [
      "facebookresearch/audiocraft",
      "Stability-AI/stable-audio-tools",
      "facebookresearch/demucs",
    ],
    licenseStatus: "review_required",
    status: "planned",
    supportedRuntimes: ["desktop_local", "local_service", "remote_service"],
    preferredRuntime: "local_service",
    installPolicy: "on_demand",
    zeroCostOnly: true,
    requiresGpu: true,
    minimumRamMb: 8192,
    modelWeightsBundled: false,
  },
  {
    id: "agent_orchestration",
    name: "Agentes especialistas",
    category: "agent_orchestration",
    description: "Coordenação de agentes, fluxos de trabalho e ferramentas especializadas.",
    sourceRepositories: [
      "langchain-ai/langgraph",
      "microsoft/autogen",
      "crewAIInc/crewAI",
    ],
    licenseStatus: "review_required",
    status: "planned",
    supportedRuntimes: ["local_service", "remote_service", "cloudflare_worker"],
    preferredRuntime: "cloudflare_worker",
    installPolicy: "optional",
    zeroCostOnly: true,
    requiresGpu: false,
    minimumRamMb: 512,
    modelWeightsBundled: false,
  },
];

const validId = /^[a-z][a-z0-9_]{1,63}$/;
const validRepository = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function createNativeCapabilityRegistry(
  definitions: NativeCapabilityDefinition[] = GARCIA_NATIVE_CAPABILITIES,
  adapters: NativeCapabilityAdapter[] = [],
): NativeCapabilityRegistry {
  if (!Array.isArray(definitions) || definitions.length > 64 ||
      !Array.isArray(adapters) || adapters.length > 64) {
    throw new Error("invalid_native_capability_registry");
  }
  const categories: NativeCapabilityCategory[] = [
    "image_generation", "video_generation", "speech_to_text", "text_to_speech",
    "voice_conversion", "vision", "document_understanding", "coding",
    "audio_generation", "agent_orchestration"
  ];
  const runtimes: NativeCapabilityRuntime[] = [
    "android_embedded", "desktop_local", "local_service", "remote_service", "cloudflare_worker"
  ];
  const statuses: NativeCapabilityStatus[] = ["planned", "adapter_ready", "available", "disabled"];
  const licenses: NativeCapabilityLicenseStatus[] = [
    "review_required", "approved", "restricted", "rejected"
  ];
  const definitionMap = new Map<string, NativeCapabilityDefinition>();
  for (const definition of definitions) {
    if (!definition || typeof definition !== "object" ||
      !validId.test(definition.id) ||
      definitionMap.has(definition.id) ||
      typeof definition.name !== "string" || !definition.name.trim() || definition.name.length > 120 ||
      typeof definition.description !== "string" || !definition.description.trim() ||
      definition.description.length > 1_000 ||
      !categories.includes(definition.category) ||
      !licenses.includes(definition.licenseStatus) ||
      !statuses.includes(definition.status) ||
      !runtimes.includes(definition.preferredRuntime) ||
      (definition.installPolicy !== "on_demand" &&
        definition.installPolicy !== "optional" && definition.installPolicy !== "bundled") ||
      typeof definition.requiresGpu !== "boolean" ||
      !Array.isArray(definition.sourceRepositories) ||
      definition.sourceRepositories.length === 0 || definition.sourceRepositories.length > 16 ||
      definition.sourceRepositories.some((repository) =>
        typeof repository !== "string" || !validRepository.test(repository)) ||
      new Set(definition.sourceRepositories).size !== definition.sourceRepositories.length ||
      !Array.isArray(definition.supportedRuntimes) ||
      definition.supportedRuntimes.length === 0 || definition.supportedRuntimes.length > runtimes.length ||
      !definition.supportedRuntimes.every((runtime) => runtimes.includes(runtime)) ||
      new Set(definition.supportedRuntimes).size !== definition.supportedRuntimes.length ||
      !definition.supportedRuntimes.includes(definition.preferredRuntime) ||
      !Number.isInteger(definition.minimumRamMb) ||
      definition.minimumRamMb < 256 ||
      definition.modelWeightsBundled !== false ||
      typeof definition.zeroCostOnly !== "boolean"
    ) {
      throw new Error("invalid_native_capability_definition");
    }
    definitionMap.set(definition.id, Object.freeze({
      ...definition,
      sourceRepositories: Object.freeze([...definition.sourceRepositories]) as unknown as string[],
      supportedRuntimes: Object.freeze([...definition.supportedRuntimes]) as unknown as NativeCapabilityRuntime[],
    }));
  }

  const adapterMap = new Map<string, NativeCapabilityAdapter>();
  for (const adapter of adapters) {
    if (!adapter || typeof adapter !== "object" ||
        typeof adapter.capabilityId !== "string" ||
        typeof adapter.execute !== "function" ||
        !runtimes.includes(adapter.runtime)) {
      throw new Error("invalid_native_capability_adapter");
    }
    const definition = definitionMap.get(adapter.capabilityId);
    if (!definition || adapterMap.has(adapter.capabilityId) ||
        !definition.supportedRuntimes.includes(adapter.runtime)) {
      throw new Error("invalid_native_capability_adapter");
    }
    adapterMap.set(adapter.capabilityId, adapter);
  }

  return {
    get: (capabilityId) => {
      const definition = definitionMap.get(capabilityId);
      return definition ? {
        ...definition,
        sourceRepositories: [...definition.sourceRepositories],
        supportedRuntimes: [...definition.supportedRuntimes],
      } : undefined;
    },
    list: () => [...definitionMap.values()].map((definition) => ({
      ...definition,
      sourceRepositories: [...definition.sourceRepositories],
      supportedRuntimes: [...definition.supportedRuntimes],
    })),
    listByCategory: (category) => [...definitionMap.values()]
      .filter((definition) => definition.category === category)
      .map((definition) => ({
        ...definition,
        sourceRepositories: [...definition.sourceRepositories],
        supportedRuntimes: [...definition.supportedRuntimes],
      })),
    getAdapter: (capabilityId) => adapterMap.get(capabilityId),
  };
}
