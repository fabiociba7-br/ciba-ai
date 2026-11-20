import type { GarciaFileCatalog, GarciaFileCreateInput, GarciaFileMetadata } from "./file-types";
import { validateGarciaFileInput, isValidStorageId, isSafeStorageText, isValidStorageDate } from "./file-validation";

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
      if (!isValidStorageId(id) || !isValidStorageDate(now)) throw new Error("invalid_file_catalog_update");
      await db.prepare("UPDATE garcia_file_objects SET status = 'available', updated_at = ? WHERE id = ? AND status = 'pending'")
        .bind(now, id).run();
    },
    async markFailed(id, now = new Date().toISOString()) {
      if (!isValidStorageId(id) || !isValidStorageDate(now)) throw new Error("invalid_file_catalog_update");
      await db.prepare("UPDATE garcia_file_objects SET status = 'failed', updated_at = ? WHERE id = ? AND status = 'pending'")
        .bind(now, id).run();
    },
    async findById(id, namespace) {
      if (!isValidStorageId(id) || !isSafeStorageText(namespace, 120)) return null;
      const row = await db.prepare(`
        SELECT id, namespace, owner_id, app_id, object_key, filename, mime_type,
          byte_size, sha256, storage_provider, bucket_name, status, source,
          created_at, updated_at, deleted_at, delete_requested_at
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
        deleteRequestedAt: typeof row.delete_requested_at === "string" ? row.delete_requested_at : null,
      };
    },
    async markDeleteRequested(id, namespace, now = new Date().toISOString()) {
      if (!isValidStorageId(id) || !isSafeStorageText(namespace, 120) || !isValidStorageDate(now)) {
        throw new Error("invalid_file_catalog_update");
      }
      await db.prepare(`
        UPDATE garcia_file_objects SET delete_requested_at = ?, updated_at = ?
        WHERE id = ? AND namespace = ? AND status = 'available'
          AND delete_requested_at IS NULL
      `).bind(now, now, id, namespace).run();
    },
    async markDeleted(id, namespace, now = new Date().toISOString()) {
      if (!isValidStorageId(id) || !isSafeStorageText(namespace, 120) || !isValidStorageDate(now)) {
        throw new Error("invalid_file_catalog_update");
      }
      await db.prepare(`
        UPDATE garcia_file_objects SET status = 'deleted', deleted_at = ?, updated_at = ?
        WHERE id = ? AND namespace = ? AND status != 'deleted'
      `).bind(now, now, id, namespace).run();
    },
  };
}
