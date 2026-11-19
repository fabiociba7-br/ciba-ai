import { describe, expect, it } from "vitest";
import { createR2ObjectStore, validateGarciaFileInput, type R2BucketLike } from "../src/core/storage-contracts";

const valid = {
  id: "file-1", namespace: "garcia:technical", objectKey: "garcia-files/docs/guide.pdf",
  filename: "guide.pdf", mimeType: "application/pdf", byteSize: 120,
  sha256: "a".repeat(64), bucketName: "garcia-files", now: "2026-11-18T12:00:00Z",
};

describe("Garcia file metadata validation", () => {
  it("accepts valid metadata without putting file bytes in SQL", () => {
    expect(() => validateGarciaFileInput(valid)).not.toThrow();
  });
  it("rejects traversal keys, invalid hashes, and unsafe sizes", () => {
    expect(() => validateGarciaFileInput({ ...valid, objectKey: "files/../secret" })).toThrow("invalid_garcia_file_metadata");
    expect(() => validateGarciaFileInput({ ...valid, sha256: "bad" })).toThrow("invalid_garcia_file_metadata");
    expect(() => validateGarciaFileInput({ ...valid, byteSize: -1 })).toThrow("invalid_garcia_file_metadata");
  });
});

describe("R2 object adapter", () => {
  it("writes content type and integrity metadata and retrieves object bodies", async () => {
    const stored = new Map<string, { body: ReadableStream; options: unknown }>();
    const body = new ReadableStream();
    const bucket: R2BucketLike = {
      async put(key, value, options) {
        stored.set(key, { body: value instanceof ReadableStream ? value : new ReadableStream(), options });
      },
      async get(key) { return stored.get(key) ?? null; },
      async delete(key) { stored.delete(key); },
    };
    const store = createR2ObjectStore(bucket);
    await store.put(valid.objectKey, body, { contentType: valid.mimeType, sha256: valid.sha256 });
    expect(stored.get(valid.objectKey)?.options).toMatchObject({
      httpMetadata: { contentType: "application/pdf" },
      customMetadata: { sha256: valid.sha256 },
    });
    expect(await store.get(valid.objectKey)).toBe(body);
    await store.delete(valid.objectKey);
    expect(await store.get(valid.objectKey)).toBeNull();
  });
  it("rejects unsafe object keys", async () => {
    const bucket: R2BucketLike = { async put() {}, async get() { return null; }, async delete() {} };
    const store = createR2ObjectStore(bucket);
    await expect(store.get("../private")).rejects.toThrow("invalid_object_storage_key");
  });
});
