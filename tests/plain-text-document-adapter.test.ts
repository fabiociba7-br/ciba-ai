import { describe, expect, it } from "vitest";
import { createPlainTextDocumentAdapter } from "../src/core/plain-text-document-adapter";
import { createNativeCapabilityRegistry, GARCIA_NATIVE_CAPABILITIES } from "../src/core/native-capabilities";

describe("local plain-text document adapter", () => {
  const adapter = createPlainTextDocumentAdapter();

  it("extracts deterministic text structure without external dependencies", async () => {
    const text = "# Overview\nFirst paragraph with café.\n\n## Details\nSecond paragraph.";
    await expect(adapter.execute({ fileName: "notes.md", text })).resolves.toEqual({
      fileName: "notes.md",
      characterCount: 67,
      byteCount: 68,
      lineCount: 5,
      nonEmptyLineCount: 4,
      wordCount: 8,
      paragraphCount: 2,
      headings: ["Overview", "Details"],
      preview: text,
    });
  });

  it("accepts only plain object text input and rejects unexpected properties", async () => {
    await expect(adapter.execute(null)).rejects.toThrow("invalid_document_input");
    await expect(adapter.execute({ text: "hello", path: "/etc/passwd" }))
      .rejects.toThrow("invalid_document_input");
    await expect(adapter.execute({ text: "hello", fileName: "../secret.txt" }))
      .rejects.toThrow("invalid_document_input");
    await expect(adapter.execute({ text: "  " })).rejects.toThrow("invalid_document_input");
  });

  it("enforces the UTF-8 byte limit, including multibyte characters", async () => {
    await expect(adapter.execute({ text: "é".repeat(32_769) }))
      .rejects.toThrow("document_text_too_large");
  });

  it("keeps the capability blocked by catalog status and license gates", () => {
    const definition = GARCIA_NATIVE_CAPABILITIES.find((item) =>
      item.id === "document_understanding")!;
    const registry = createNativeCapabilityRegistry([definition], [adapter]);
    expect(registry.getReadiness(definition.id)).toMatchObject({
      adapterRegistered: true,
      adapterRuntime: "desktop_local",
      executable: false,
      blockers: ["not_available", "license_review_required"],
    });
    expect(registry.getAdapter(definition.id)).toBeUndefined();
  });
});
