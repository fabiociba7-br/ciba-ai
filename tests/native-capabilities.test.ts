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
    const available = {
      ...GARCIA_NATIVE_CAPABILITIES[0]!,
      status: "available" as const,
      licenseStatus: "approved" as const,
    };
    const adapter: NativeCapabilityAdapter = {
      capabilityId: available.id,
      runtime: "desktop_local",
      execute: async () => ({ accepted: true }),
    };
    const registry = createNativeCapabilityRegistry([available], [adapter]);
    expect(registry.getAdapter(available.id)).toBe(adapter);
    expect(() => createNativeCapabilityRegistry([available], [{
      ...adapter,
      runtime: "android_embedded",
    }])).toThrow("invalid_native_capability_adapter");
  });

  it("reports blockers and never exposes an adapter before availability and license approval", () => {
    const definition = GARCIA_NATIVE_CAPABILITIES[0]!;
    const adapter: NativeCapabilityAdapter = {
      capabilityId: definition.id,
      runtime: "desktop_local",
      execute: async () => ({ accepted: true }),
    };
    const registry = createNativeCapabilityRegistry([definition], [adapter]);
    expect(registry.getReadiness(definition.id)).toEqual({
      capabilityId: definition.id,
      status: "planned",
      licenseStatus: "review_required",
      adapterRegistered: true,
      adapterRuntime: "desktop_local",
      executable: false,
      blockers: ["not_available", "license_review_required"],
    });
    expect(registry.getAdapter(definition.id)).toBeUndefined();
    expect(registry.getReadiness("unknown_capability")).toBeUndefined();
    expect(registry.getAdapter("unknown_capability")).toBeUndefined();
  });

  it("exposes an adapter only when capability is available and license-approved", () => {
    const definition = {
      ...GARCIA_NATIVE_CAPABILITIES[0]!,
      status: "available" as const,
      licenseStatus: "approved" as const,
    };
    const adapter: NativeCapabilityAdapter = {
      capabilityId: definition.id,
      runtime: "desktop_local",
      execute: async () => ({ accepted: true }),
    };
    const registry = createNativeCapabilityRegistry([definition], [adapter]);
    expect(registry.getReadiness(definition.id)).toEqual({
      capabilityId: definition.id,
      status: "available",
      licenseStatus: "approved",
      adapterRegistered: true,
      adapterRuntime: "desktop_local",
      executable: true,
      blockers: [],
    });
    expect(registry.getAdapter(definition.id)).toBe(adapter);
  });

  it("reports a missing adapter as a blocker even when metadata says available", () => {
    const definition = {
      ...GARCIA_NATIVE_CAPABILITIES[0]!,
      status: "available" as const,
      licenseStatus: "approved" as const,
    };
    const registry = createNativeCapabilityRegistry([definition]);
    expect(registry.getReadiness(definition.id)).toMatchObject({
      executable: false,
      adapterRegistered: false,
      blockers: ["adapter_missing"],
    });
    expect(registry.getAdapter(definition.id)).toBeUndefined();
  });

  it("does not expose adapters for disabled capabilities", () => {
    const definition = {
      ...GARCIA_NATIVE_CAPABILITIES[0]!,
      status: "disabled" as const,
      licenseStatus: "approved" as const,
    };
    const adapter: NativeCapabilityAdapter = {
      capabilityId: definition.id,
      runtime: "desktop_local",
      execute: async () => ({ accepted: true }),
    };
    const registry = createNativeCapabilityRegistry([definition], [adapter]);
    expect(registry.getReadiness(definition.id)?.blockers).toContain("disabled");
    expect(registry.getAdapter(definition.id)).toBeUndefined();
  });

  it("does not invent adapters for catalog entries", () => {
    const registry = createNativeCapabilityRegistry();
    expect(registry.getAdapter("image_generation")).toBeUndefined();
    expect(registry.getReadiness("image_generation")).toMatchObject({
      executable: false,
      blockers: ["not_available", "license_review_required", "adapter_missing"],
    });
    expect(registry.get("unknown_capability")).toBeUndefined();
  });
});
