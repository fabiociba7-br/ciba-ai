import type {
  GarciaFileCatalog,
  GarciaFileCreateInput,
  GarciaFileMetadata,
  GarciaObjectStore,
} from "./file-types";

export interface GarciaFileUploadInput extends GarciaFileCreateInput {
  bytes: ArrayBuffer | ArrayBufferView;
}

export interface GarciaFileDownload {
  metadata: GarciaFileMetadata;
  body: ReadableStream;
}

const MAX_FILE_BYTES = 25 * 1024 * 1024;

function asBytes(input: ArrayBuffer | ArrayBufferView): Uint8Array {
  return input instanceof ArrayBuffer
    ? new Uint8Array(input)
    : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const stableBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(stableBuffer).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", stableBuffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Coordinates D1 metadata and R2 bytes without ever storing file content in SQL. */
export function createGarciaFileLifecycle(
  catalog: GarciaFileCatalog,
  objects: GarciaObjectStore,
) {
  return {
    async upload(input: GarciaFileUploadInput): Promise<GarciaFileMetadata> {
      if (!input || !(input.bytes instanceof ArrayBuffer || ArrayBuffer.isView(input.bytes))) {
        throw new Error("invalid_garcia_file_payload");
      }
      const bytes = asBytes(input.bytes);
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_FILE_BYTES ||
          !Number.isSafeInteger(input.byteSize) || input.byteSize !== bytes.byteLength) {
        throw new Error("invalid_garcia_file_size");
      }
      const actualHash = await sha256Hex(bytes);
      if (actualHash !== input.sha256) throw new Error("garcia_file_integrity_mismatch");

      const { bytes: _bytes, ...metadata } = input;
      await catalog.createPending(metadata);
      try {
        await objects.put(input.objectKey, bytes, {
          contentType: input.mimeType,
          sha256: actualHash,
        });
        await catalog.markAvailable(input.id, input.now);
      } catch (error) {
        try { await objects.delete(input.objectKey); } catch { /* best-effort cleanup */ }
        try { await catalog.markFailed(input.id, input.now); } catch { /* retain original failure */ }
        throw error;
      }
      return {
        ...metadata,
        ownerId: metadata.ownerId ?? null,
        appId: metadata.appId ?? null,
        storageProvider: "cloudflare_r2",
        status: "available",
        source: metadata.source ?? "user",
        createdAt: input.now ?? new Date().toISOString(),
        updatedAt: input.now ?? new Date().toISOString(),
        deletedAt: null,
      };
    },

    async download(id: string, namespace: string): Promise<GarciaFileDownload> {
      const metadata = await catalog.findById(id, namespace);
      if (!metadata || metadata.status !== "available" || metadata.deleteRequestedAt) throw new Error("garcia_file_not_available");
      const body = await objects.get(metadata.objectKey);
      if (!body) throw new Error("garcia_file_object_missing");
      return { metadata, body };
    },

    async delete(id: string, namespace: string, now?: string): Promise<boolean> {
      const metadata = await catalog.findById(id, namespace);
      if (!metadata) return false;
      if (metadata.status !== "available") throw new Error("garcia_file_not_available");
      // Persist intent first. If object deletion or the final D1 update fails, a
      // later retry can safely resume without exposing the object for download.
      if (!metadata.deleteRequestedAt) await catalog.markDeleteRequested(id, namespace, now);
      await objects.delete(metadata.objectKey);
      await catalog.markDeleted(id, namespace, now);
      return true;
    },
  };
}
