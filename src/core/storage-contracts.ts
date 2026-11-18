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

const ID = /^[A-Za-z0-9._:-]{1,200}$/;
const HASH = /^[a-f0-9]{64}$/;
const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;
const safeText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const validDate = (value: string) => Number.isFinite(Date.parse(value));

export function validateGarciaFileInput(input: GarciaFileCreateInput): void {
  if (!input || !ID.test(input.id) || !safeText(input.namespace, 120) ||
      !(input.ownerId == null || safeText(input.ownerId, 200)) ||
      !(input.appId == null || safeText(input.appId, 200)) ||
      !safeText(input.objectKey, 1_024) || input.objectKey.startsWith("/") ||
      input.objectKey.split("/").some((part) => part === "..") ||
      !safeText(input.filename, 255) || !MIME.test(input.mimeType) ||
      !Number.isSafeInteger(input.byteSize) || input.byteSize < 0 ||
      !HASH.test(input.sha256) || !safeText(input.bucketName, 100) ||
      !(input.source === undefined || safeText(input.source, 80)) ||
      !(input.now === undefined || validDate(input.now))) {
    throw new Error("invalid_garcia_file_metadata");
  }
}

/** Thin adapter: the bucket owns bytes; D1 owns the catalog. */
export function createR2ObjectStore(bucket: R2BucketLike): GarciaObjectStore {
  return {
    async put(key, body, options) {
      if (!safeText(key, 1_024) || key.startsWith("/") || key.split("/").includes("..") ||
          !MIME.test(options.contentType) || !HASH.test(options.sha256)) {
        throw new Error("invalid_object_storage_input");
      }
      await bucket.put(key, body, {
        httpMetadata: { contentType: options.contentType },
        customMetadata: { sha256: options.sha256 },
      });
    },
    async get(key) {
      if (!safeText(key, 1_024) || key.startsWith("/") || key.split("/").includes("..")) {
        throw new Error("invalid_object_storage_key");
      }
      const object = await bucket.get(key);
      return object?.body ?? null;
    },
    async delete(key) {
      if (!safeText(key, 1_024) || key.startsWith("/") || key.split("/").includes("..")) {
        throw new Error("invalid_object_storage_key");
      }
      await bucket.delete(key);
    },
  };
}

export function createD1FileCatalog(db: D1Database): GarciaFileCatalog {
  return {
    async createPending(input) {
      validateGarciaFileInput(input);
      const now = input.now ?? new Date().toISOString();
      await db.prepare(`
        INSERT INTO garcia_file_objects (
          id, namespace, owner_id, app_id, object_key, filename, mime_type,
          byte_size, sha256, storage_provider, bucket_name, status, source,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'cloudflare_r2', ?, 'pending', ?, ?, ?)
      `).bind(
        input.id, input.namespace, input.ownerId ?? null, input.appId ?? null,
        input.objectKey, input.filename, input.mimeType, input.byteSize,
        input.sha256, input.bucketName, input.source ?? "user", now, now,
      ).run();
    },
    async markAvailable(id, now = new Date().toISOString()) {
      if (!ID.test(id) || !validDate(now)) throw new Error("invalid_file_catalog_update");
      await db.prepare("UPDATE garcia_file_objects SET status = 'available', updated_at = ? WHERE id = ? AND status = 'pending'")
        .bind(now, id).run();
    },
    async markFailed(id, now = new Date().toISOString()) {
      if (!ID.test(id) || !validDate(now)) throw new Error("invalid_file_catalog_update");
      await db.prepare("UPDATE garcia_file_objects SET status = 'failed', updated_at = ? WHERE id = ? AND status = 'pending'")
        .bind(now, id).run();
    },
    async findById(id, namespace) {
      if (!ID.test(id) || !safeText(namespace, 120)) return null;
      const row = await db.prepare(`
        SELECT id, namespace, owner_id, app_id, object_key, filename, mime_type,
          byte_size, sha256, storage_provider, bucket_name, status, source,
          created_at, updated_at, deleted_at
        FROM garcia_file_objects WHERE id = ? AND namespace = ? AND status != 'deleted'
      `).bind(id, namespace).first<Record<string, unknown>>();
      if (!row) return null;
      return {
        id: String(row.id), namespace: String(row.namespace),
        ownerId: typeof row.owner_id === "string" ? row.owner_id : null,
        appId: typeof row.app_id === "string" ? row.app_id : null,
        objectKey: String(row.object_key), filename: String(row.filename),
        mimeType: String(row.mime_type), byteSize: Number(row.byte_size),
        sha256: String(row.sha256), storageProvider: "cloudflare_r2",
        bucketName: String(row.bucket_name), status: row.status as GarciaFileMetadata["status"],
        source: String(row.source), createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        deletedAt: typeof row.deleted_at === "string" ? row.deleted_at : null,
      };
    },
    async markDeleted(id, namespace, now = new Date().toISOString()) {
      if (!ID.test(id) || !safeText(namespace, 120) || !validDate(now)) {
        throw new Error("invalid_file_catalog_update");
      }
      await db.prepare(`
        UPDATE garcia_file_objects SET status = 'deleted', deleted_at = ?, updated_at = ?
        WHERE id = ? AND namespace = ? AND status != 'deleted'
      `).bind(now, now, id, namespace).run();
    },
  };
}
