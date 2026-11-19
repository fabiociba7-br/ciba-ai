export type GarciaStorageProvider = "cloudflare_d1" | "turso" | "neon" | "cloudflare_r2";
export type GarciaFileStatus = "pending" | "available" | "failed" | "deleted";

export interface GarciaFileMetadata {
  id: string;
  namespace: string;
  ownerId: string | null;
  appId: string | null;
  objectKey: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  storageProvider: "cloudflare_r2";
  bucketName: string;
  status: GarciaFileStatus;
  source: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  deleteRequestedAt: string | null;
}

export interface GarciaFileCreateInput {
  id: string;
  namespace: string;
  ownerId?: string | null;
  appId?: string | null;
  objectKey: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  bucketName: string;
  source?: string;
  now?: string;
}

export interface GarciaFileCatalog {
  createPending(input: GarciaFileCreateInput): Promise<void>;
  markAvailable(id: string, now?: string): Promise<void>;
  markFailed(id: string, now?: string): Promise<void>;
  findById(id: string, namespace: string): Promise<GarciaFileMetadata | null>;
  markDeleteRequested(id: string, namespace: string, now?: string): Promise<void>;
  markDeleted(id: string, namespace: string, now?: string): Promise<void>;
}

/** Provider-neutral object API. File bytes never belong in SQL rows or outbox JSON. */
export interface GarciaObjectStore {
  put(key: string, body: ReadableStream | ArrayBuffer | ArrayBufferView | Blob | string, options: {
    contentType: string;
    sha256: string;
  }): Promise<void>;
  get(key: string): Promise<ReadableStream | null>;
  delete(key: string): Promise<void>;
}

export interface R2BucketLike {
  put(key: string, body: ReadableStream | ArrayBuffer | ArrayBufferView | Blob | string, options?: {
    httpMetadata?: { contentType?: string };
    customMetadata?: Record<string, string>;
  }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream } | null>;
  delete(key: string): Promise<void>;
}

