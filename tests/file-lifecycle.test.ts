import { describe, expect, it } from "vitest";
import { createGarciaFileLifecycle } from "../src/core/storage/file-lifecycle";
import type { GarciaFileCatalog, GarciaFileMetadata, GarciaObjectStore } from "../src/core/storage/file-types";

const bytes = new TextEncoder().encode("hello");
const input = {
  id: "file-1", namespace: "garcia:technical", objectKey: "garcia-files/docs/hello.txt",
  filename: "hello.txt", mimeType: "text/plain", byteSize: 5,
  sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  bucketName: "garcia-files", now: "2026-11-18T12:00:00.000Z", bytes,
};

function setup() {
  const calls: string[] = [];
  let stored: ReadableStream | null = null;
  const { bytes: _bytes, ...baseMetadata } = input;
  const metadata: GarciaFileMetadata = {
    ...baseMetadata, ownerId: null, appId: null,
    storageProvider: "cloudflare_r2", status: "available", source: "user",
    createdAt: input.now, updatedAt: input.now, deletedAt: null,
  };
  const catalog: GarciaFileCatalog = {
    async createPending() { calls.push("pending"); },
    async markAvailable() { calls.push("available"); },
    async markFailed() { calls.push("failed"); },
    async findById() { return metadata; },
    async markDeleted() { calls.push("deleted"); },
  };
  const objects: GarciaObjectStore = {
    async put(_key, body) { calls.push("put"); stored = body instanceof ReadableStream ? body : new ReadableStream(); },
    async get() { calls.push("get"); return stored; },
    async delete() { calls.push("delete"); stored = null; },
  };
  return { lifecycle: createGarciaFileLifecycle(catalog, objects), calls, metadata };
}

describe("Garcia R2 file lifecycle", () => {
  it("checks SHA-256 and commits metadata only after storing bytes", async () => {
    const { lifecycle, calls } = setup();
    const result = await lifecycle.upload(input);
    expect(calls).toEqual(["pending", "put", "available"]);
    expect(result.status).toBe("available");
    expect(result.storageProvider).toBe("cloudflare_r2");
  });

  it("rejects content whose digest does not match before creating metadata", async () => {
    const { lifecycle, calls } = setup();
    await expect(lifecycle.upload({ ...input, sha256: "a".repeat(64) }))
      .rejects.toThrow("garcia_file_integrity_mismatch");
    expect(calls).toEqual([]);
  });

  it("downloads only catalogued available objects and deletes bytes before metadata", async () => {
    const { lifecycle, calls, metadata } = setup();
    const body = new ReadableStream();
    const result = await lifecycle.download("file-1", "garcia:technical");
    expect(result.metadata).toBe(metadata);
    expect(result.body).toBeInstanceOf(ReadableStream);
    expect(calls).toContain("get");
    expect(await lifecycle.delete("file-1", "garcia:technical", input.now)).toBe(true);
    expect(calls.slice(-2)).toEqual(["delete", "deleted"]);
  });
});
