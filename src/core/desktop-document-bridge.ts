import type { NativeCapabilityAdapter } from "./native-capabilities";
import { createPlainTextDocumentAdapter, type PlainTextDocumentResult } from "./plain-text-document-adapter";

const MAX_TEXT_BYTES = 64 * 1024;
const MAX_HOST_VERSION_CHARS = 80;

export interface DesktopDocumentBridgeStatus {
  runtimeReady: boolean;
  hostVersion?: string;
}

export interface DesktopSelectedTextDocument {
  /** Display name only; never a path or URI. */
  fileName: string;
  text: string;
}

/**
 * Implemented by a trusted desktop shell. readSelectedTextDocument must open
 * the platform's user-facing file picker and return only the selected text.
 * The bridge must not accept arbitrary paths or perform network access.
 */
export interface DesktopDocumentBridge {
  getStatus(): Promise<DesktopDocumentBridgeStatus>;
  readSelectedTextDocument(options: { maxBytes: number }): Promise<DesktopSelectedTextDocument>;
}

export interface DesktopDocumentConsent {
  granted: true;
  purpose: "document_read";
  source: "explicit_user_action";
}

function ownDataRecord(value: unknown, allowed: string[]): Record<string, unknown> | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string" || !allowed.includes(key))) return null;
    const result: Record<string, unknown> = Object.create(null);
    for (const key of keys as string[]) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return null;
  }
}

function validateConsent(value: unknown): boolean {
  const consent = ownDataRecord(value, ["granted", "purpose", "source"]);
  return Boolean(consent && Object.keys(consent).length === 3 &&
    consent.granted === true && consent.purpose === "document_read" &&
    consent.source === "explicit_user_action");
}

function snapshotStatus(value: unknown): DesktopDocumentBridgeStatus | null {
  const status = ownDataRecord(value, ["runtimeReady", "hostVersion"]);
  if (!status || typeof status.runtimeReady !== "boolean" ||
      (status.hostVersion !== undefined &&
        (typeof status.hostVersion !== "string" ||
         status.hostVersion.length > MAX_HOST_VERSION_CHARS))) return null;
  return Object.freeze({
    runtimeReady: status.runtimeReady,
    ...(typeof status.hostVersion === "string" ? { hostVersion: status.hostVersion } : {}),
  });
}

function snapshotDocument(value: unknown): DesktopSelectedTextDocument | null {
  const document = ownDataRecord(value, ["fileName", "text"]);
  if (!document || Object.keys(document).length !== 2 ||
      typeof document.fileName !== "string" ||
      typeof document.text !== "string") return null;
  return Object.freeze({ fileName: document.fileName, text: document.text });
}

/**
 * Desktop-only bridge adapter. It asks the host for a user-selected text file
 * only after explicit consent, then analyzes the returned text in-process.
 * The adapter itself never reads paths, opens files, or contacts a service.
 */
export function createDesktopDocumentBridgeAdapter(
  bridge: DesktopDocumentBridge,
): NativeCapabilityAdapter {
  if (!bridge || typeof bridge !== "object" ||
      typeof bridge.getStatus !== "function" ||
      typeof bridge.readSelectedTextDocument !== "function") {
    throw new Error("invalid_desktop_document_bridge");
  }

  const getStatus = bridge.getStatus.bind(bridge);
  const readSelectedTextDocument = bridge.readSelectedTextDocument.bind(bridge);
  const analyzer = createPlainTextDocumentAdapter();

  return Object.freeze({
    capabilityId: "document_understanding",
    runtime: "desktop_local" as const,
    async execute(input: unknown): Promise<PlainTextDocumentResult> {
      const request = ownDataRecord(input, ["consent"]);
      if (!request || Object.keys(request).length !== 1 || !validateConsent(request.consent)) {
        throw new Error("document_read_consent_required");
      }

      let status: DesktopDocumentBridgeStatus | null;
      try {
        status = snapshotStatus(await getStatus());
      } catch {
        throw new Error("desktop_document_host_unavailable");
      }
      if (!status) throw new Error("desktop_document_host_invalid_status");
      if (!status.runtimeReady) throw new Error("desktop_document_host_unavailable");

      let selected: DesktopSelectedTextDocument | null;
      try {
        selected = snapshotDocument(await readSelectedTextDocument({ maxBytes: MAX_TEXT_BYTES }));
      } catch {
        throw new Error("desktop_document_selection_failed");
      }
      if (!selected) throw new Error("desktop_document_invalid_selection");

      return analyzer.execute({ fileName: selected.fileName, text: selected.text }) as Promise<PlainTextDocumentResult>;
    },
  });
}
