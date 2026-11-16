import { describe, expect, it, vi } from "vitest";
import { createGarciaCapabilityTools } from "../src/core/tools/garcia-capability-tools";

describe("Garcia read-only capability catalog tools", () => {
  it("lists only catalog metadata and can filter by category", async () => {
    const authorize = vi.fn(async () => true);
    const registry = createGarciaCapabilityTools({ authorize });

    expect(registry.list().map((tool) => tool.id)).toEqual([
      "garcia.capabilities.list",
      "garcia.capabilities.get",
    ]);
    expect(registry.list().every((tool) => tool.risk === "read" && !tool.requiresApproval)).toBe(true);

    const all = await registry.execute("garcia.capabilities.list", {});
    expect(all).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "coding_agent",
        status: "planned",
        modelWeightsBundled: false,
      }),
    ]));

    const speech = await registry.execute("garcia.capabilities.list", {
      category: "speech_to_text",
    }) as Array<{ id: string }>;
    expect(speech.map((item) => item.id)).toEqual(["speech_to_text"]);
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({
      toolId: "garcia.capabilities.list",
      risk: "read",
      requiresApproval: false,
    }));
  });

  it("returns one capability without inventing an adapter or claiming availability", async () => {
    const registry = createGarciaCapabilityTools({ authorize: async () => true });
    const result = await registry.execute("garcia.capabilities.get", {
      capabilityId: "image_generation",
    }) as { found: boolean; capability: { status: string; modelWeightsBundled: boolean } };

    expect(result.found).toBe(true);
    expect(result.capability.status).toBe("planned");
    expect(result.capability.modelWeightsBundled).toBe(false);
  });

  it("returns a safe not-found result for unknown capabilities", async () => {
    const registry = createGarciaCapabilityTools({ authorize: async () => true });
    await expect(registry.execute("garcia.capabilities.get", {
      capabilityId: "unknown.capability",
    })).resolves.toEqual({ found: false });
  });

  it("rejects unknown properties and invalid categories before authorization", async () => {
    const authorize = vi.fn(async () => true);
    const registry = createGarciaCapabilityTools({ authorize });

    await expect(registry.execute("garcia.capabilities.list", {
      category: "not-a-category",
    })).rejects.toThrow("invalid_tool_input");
    await expect(registry.execute("garcia.capabilities.get", {
      capabilityId: "image_generation",
      install: true,
    })).rejects.toThrow("invalid_tool_input");
    expect(authorize).not.toHaveBeenCalled();
  });

  it("fails closed when the trusted application policy denies access", async () => {
    const registry = createGarciaCapabilityTools({ authorize: async () => false });
    await expect(registry.execute("garcia.capabilities.list", {}))
      .rejects.toThrow("tool_authorization_denied");
  });

  it("requires a trusted authorizer and does not expose write or external tools", () => {
    expect(() => createGarciaCapabilityTools({ authorize: undefined as never }))
      .toThrow("garcia_capability_authorizer_required");
    const registry = createGarciaCapabilityTools({ authorize: async () => true });
    expect(registry.describe().every((tool) => tool.risk === "read")).toBe(true);
    expect(registry.get("garcia.capabilities.install")).toBeUndefined();
  });
});
