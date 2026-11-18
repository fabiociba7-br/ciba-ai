import type { GarciaObjectStore, R2BucketLike } from "./file-types";
import { isSafeStorageText, isValidStorageMime, isValidStorageHash } from "./file-validation";

/** Thin adapter: the bucket owns bytes; D1 owns the catalog. */
export function createR2ObjectStore(bucket: R2BucketLike): GarciaObjectStore {
  return {
    async put(key, body, options) {
      if (!isSafeStorageText(key, 1_024) || key.startsWith("/") || key.split("/").includes("..") ||
          !isValidStorageMime(options.contentType) || !isValidStorageHash(options.sha256)) {
        throw new Error("invalid_object_storage_input");
      }
      await bucket.put(key, body, {
        httpMetadata: { contentType: options.contentType },
        customMetadata: { sha256: options.sha256 },
      });
    },
    async get(key) {
      if (!isSafeStorageText(key, 1_024) || key.startsWith("/") || key.split("/").includes("..")) {
        throw new Error("invalid_object_storage_key");
      }
      const object = await bucket.get(key);
      return object?.body ?? null;
    },
    async delete(key) {
      if (!isSafeStorageText(key, 1_024) || key.startsWith("/") || key.split("/").includes("..")) {
        throw new Error("invalid_object_storage_key");
      }
      await bucket.delete(key);
    },
  };
}

