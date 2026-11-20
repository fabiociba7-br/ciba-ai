import { describe, expect, it, vi } from "vitest";
import { createDesktopDocumentBridgeAdapter, type DesktopDocumentBridge } from "../src/core/desktop-document-bridge";
import { createNativeCapabilityRegistry, GARCIA_NATIVE_CAPABILITIES } from "../src/core/native-capabilities";

const consent = { granted: true, purpose: "document_read", source: "explicit_user_action" } as const;

function createBridge(overrides: Partial<DesktopDocumentBridge> = {}): DesktopDocumentBridge {
  return {
    getStatus: vi.fn(async () => ({ runtimeReady: true, hostVersion: "1.0" })),
    readSelectedTextDocument: vi.fn(async () => ({
      fileName: "report.md",
      text: "# Report\nLocal content",
    })),
    ...overrides,
  };
}

describe("desktop document bridge adapter", () => {
  it("uses the host file picker only after explicit user consent and analyzes its text", async () => {
    const bridge = createBridge();
    const adapter = createDesktopDocumentBridgeAdapter(bridge);
    await expect(adapter.execute({ consent })).resolves.toMatchObject({
      fileName: "report.md",
      headings: ["Report"],
      wordCount: 3,
    });
    expect(bridge.getStatus).toHaveBeenCalledOnce();
    expect(bridge.readSelectedTextDocument).toHaveBeenCalledOnce();
    expect(bridge.readSelectedTextDocument).toHaveBeenCalledWith({ maxBytes: 64 * 1024 });
  });

  it("does not query or invoke the host without exact explicit consent", async () => {
    const bridge = createBridge();
    const adapter = createDesktopDocumentBridgeAdapter(bridge);
    await expect(adapter.execute({})).rejects.toThrow("document_read_consent_required");
    await expect(adapter.execute({ consent: { ...consent, source: "background" } }))
      .rejects.toThrow("document_read_consent_required");
    expect(bridge.getStatus).not.toHaveBeenCalled();
    expect(bridge.readSelectedTextDocument).not.toHaveBeenCalled();
  });

  it("blocks unavailable or malformed hosts before opening the picker", async () => {
    const unavailable = createBridge({
      getStatus: vi.fn(async () => ({ runtimeReady: false })),
    });
    await expect(createDesktopDocumentBridgeAdapter(unavailable).execute({ consent }))
      .rejects.toThrow("desktop_document_host_unavailable");
    expect(unavailable.readSelectedTextDocument).not.toHaveBeenCalled();

    const malformed = createBridge({
      getStatus: vi.fn(async () => ({ runtimeReady: "yes" } as unknown as { runtimeReady: boolean })),
    });
    await expect(createDesktopDocumentBridgeAdapter(malformed).execute({ consent }))
      .rejects.toThrow("desktop_document_host_invalid_status");
    expect(malformed.readSelectedTextDocument).not.toHaveBeenCalled();
  });

  it("rejects path-like names, oversized text and malformed host payloads", async () => {
    const pathName = createBridge({
      readSelectedTextDocument: vi.fn(async () => ({ fileName: "../private.txt", text: "hello" })),
    });
    await expect(createDesktopDocumentBridgeAdapter(pathName).execute({ consent }))
      .rejects.toThrow("invalid_document_input");

    const oversized = createBridge({
      readSelectedTextDocument: vi.fn(async () => ({ fileName: "big.txt", text: "x".repeat(65 * 1024) })),
    });
    await expect(createDesktopDocumentBridgeAdapter(oversized).execute({ consent }))
      .rejects.toThrow("document_text_too_large");

    const malformed = createBridge({
      readSelectedTextDocument: vi.fn(async () => ({ fileName: "ok.txt", text: "hello", path: "/etc/passwd" } as never)),
    });
    await expect(createDesktopDocumentBridgeAdapter(malformed).execute({ consent }))
      .rejects.toThrow("desktop_document_invalid_selection");
  });

  it("keeps the capability blocked by catalog status and license gates", () => {
    const definition = GARCIA_NATIVE_CAPABILITIES.find((item) =>
      item.id === "document_understanding")!;
    const adapter = createDesktopDocumentBridgeAdapter(createBridge());
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
