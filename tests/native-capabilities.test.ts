import { describe, expect, it } from "vitest";
import {
  GARCIA_NATIVE_CAPABILITIES,
  createNativeCapabilityRegistry,
  type NativeCapabilityAdapter,
  type NativeCapabilityDefinition,
} from "../src/core/native-capabilities";

describe("Garcia native AI capability foundation", () => {
  it("publishes the planned multimodal and coding capabilities without claiming they are installed", () => {
    const registry = createNativeCapabilityRegistry();
    const capabilities = registry.list();

    expect(capabilities.map((item) => item.id)).toEqual(expect.arrayContaining([
      "image_generation",
      "video_generation",
      "speech_to_text",
      "text_to_speech",
      "voice_conversion",
      "computer_vision",
      "document_understanding",
      "coding_agent",
      "audio_generation",
      "agent_orchestration",
    ]));
    expect(capabilities.every((item) => item.status === "planned")).toBe(true);
    expect(capabilities.every((item) => item.modelWeightsBundled === false)).toBe(true);
    expect(capabilities.every((item) => item.licenseStatus === "review_required")).toBe(true);
  });

  it("returns defensive copies of catalog metadata", () => {
    const registry = createNativeCapabilityRegistry();
    const first = registry.get("image_generation");
    expect(first).toBeDefined();
    first?.sourceRepositories.push("attacker/modified");
    expect(registry.get("image_generation")?.sourceRepositories).not.toContain("attacker/modified");
  });

  it("filters capabilities by category", () => {
    const registry = createNativeCapabilityRegistry();
    expect(registry.listByCategory("speech_to_text").map((item) => item.id))
      .toEqual(["speech_to_text"]);
  });

  it("rejects malformed or duplicate capability definitions", () => {
    const base = GARCIA_NATIVE_CAPABILITIES[0]!;
    const invalid = { ...base, id: "INVALID ID" } as NativeCapabilityDefinition;
    expect(() => createNativeCapabilityRegistry([invalid])).toThrow("invalid_native_capability_definition");
    expect(() => createNativeCapabilityRegistry([base, base])).toThrow("invalid_native_capability_definition");
  });

  it("only registers adapters for declared capabilities and supported runtimes", () => {
    const adapter: NativeCapabilityAdapter = {
      capabilityId: "image_generation",
      runtime: "desktop_local",
      execute: async () => ({ accepted: true }),
    };
    const registry = createNativeCapabilityRegistry(GARCIA_NATIVE_CAPABILITIES, [adapter]);
    expect(registry.getAdapter("image_generation")).toBe(adapter);
    expect(() => createNativeCapabilityRegistry(GARCIA_NATIVE_CAPABILITIES, [{
      ...adapter,
      runtime: "android_embedded",
    }])).toThrow("invalid_native_capability_adapter");
  });

  it("does not invent adapters for catalog entries", () => {
    const registry = createNativeCapabilityRegistry();
    expect(registry.getAdapter("image_generation")).toBeUndefined();
    expect(registry.get("unknown_capability")).toBeUndefined();
  });
});
