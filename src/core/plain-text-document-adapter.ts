import type { NativeCapabilityAdapter } from "./native-capabilities";

const MAX_TEXT_BYTES = 64 * 1024;
const MAX_FILE_NAME_CHARS = 180;
const encoder = new TextEncoder();

export interface PlainTextDocumentInput {
  text: string;
  fileName?: string;
}

export interface PlainTextDocumentResult {
  fileName: string | null;
  characterCount: number;
  byteCount: number;
  lineCount: number;
  nonEmptyLineCount: number;
  wordCount: number;
  paragraphCount: number;
  headings: string[];
  preview: string;
}

/** Dependency-free local text analyzer. Text only; no filesystem, OCR, or network access. */
export function createPlainTextDocumentAdapter(): NativeCapabilityAdapter {
  return Object.freeze({
    capabilityId: "document_understanding",
    runtime: "desktop_local" as const,
    async execute(input: unknown): Promise<PlainTextDocumentResult> {
      if (input === null || typeof input !== "object" || Array.isArray(input) ||
          Object.getPrototypeOf(input) !== Object.prototype) {
        throw new Error("invalid_document_input");
      }
      const descriptors = Object.getOwnPropertyDescriptors(input);
      const keys = Reflect.ownKeys(descriptors);
      if (keys.some((key) => typeof key !== "string" || !["text", "fileName"].includes(key)) ||
          !descriptors.text || !("value" in descriptors.text) || !descriptors.text.enumerable ||
          (descriptors.fileName && (!("value" in descriptors.fileName) ||
            !descriptors.fileName.enumerable))) {
        throw new Error("invalid_document_input");
      }
      const text = descriptors.text.value;
      const fileName = descriptors.fileName?.value;
      if (typeof text !== "string" || !text.trim() ||
          (fileName !== undefined &&
            (typeof fileName !== "string" || fileName.length > MAX_FILE_NAME_CHARS ||
             /[\\/\u0000-\u001f]/.test(fileName))))
        throw new Error("invalid_document_input");
      }
      const byteCount = encoder.encode(text).byteLength;
      if (byteCount > MAX_TEXT_BYTES) throw new Error("document_text_too_large");

      const normalized = text.replace(/\r\n?/g, "\n");
      const lines = normalized.split("\n");
      const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
      const headings = lines
        .map((line) => line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/)?.[1])
        .filter((heading): heading is string => Boolean(heading))
        .slice(0, 50);
      const words = normalized.match(/[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*/gu) ?? [];
      const paragraphs = normalized.trim().split(/\n\s*\n+/).filter(Boolean);

      return {
        fileName: typeof fileName === "string" ? fileName : null,
        characterCount: [...text].length,
        byteCount,
        lineCount: lines.length,
        nonEmptyLineCount: nonEmptyLines.length,
        wordCount: words.length,
        paragraphCount: paragraphs.length,
        headings,
        preview: normalized.slice(0, 500),
      };
    },
  });
}
