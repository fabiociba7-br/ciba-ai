export type ResearchDepth = "quick" | "standard" | "deep";
export type VisualMode = "generate" | "search";
export interface ResearchToolInput {
  topic: string; depth?: ResearchDepth; focus?: string[]; visual_mode?: boolean;
  mode?: VisualMode; session_id?: string; feedback?: string;
}
export interface ResearchSource { title: string; url: string; snippet: string; query: string; }
export interface ResearchReport {
  topic: string; depth: ResearchDepth; queries: string[]; executiveSummary: string;
  insights: string[]; recommendations: string[]; limitations: string[];
  sources: ResearchSource[]; generatedAt: string;
  artifacts?: { json_url: string; markdown_url: string };
}
export interface AIService { run(model: string, input: Record<string, unknown>): Promise<unknown>; }
export interface KVNamespaceLike { get(key: string): Promise<string | null>; put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>; }
export interface R2BucketLike {
  put(key: string, value: ArrayBuffer | ArrayBufferView | ReadableStream | string, options?: Record<string, unknown>): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream; httpEtag: string; size: number; httpMetadata?: { contentType?: string }; writeHttpMetadata(headers: Headers): void } | null>;
  delete(key: string): Promise<void>;
}
export interface ResearchEnv {
  AI: AIService; DB: D1Database; GARCIA_ARTIFACTS: R2BucketLike; GARCIA_PROMPT_CACHE: KVNamespaceLike;
  AI_MODEL?: string; GARCIA_IMAGE_MODEL?: string; GARCIA_VISION_MODEL?: string;
  PUBLIC_API_BASE_URL?: string; ARTIFACT_URL_SECRET?: string; ARTIFACT_URL_TTL_SECONDS?: string;
  ownerId: string; appId: string; deviceId: string;
}
export interface ResearchSourceImage { title: string; pageUrl: string; imageUrl: string; thumbnailUrl?: string; width?: number; height?: number; }
