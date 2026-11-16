import { describe, expect, it } from "vitest";
import {
  CIBAGENIO_RESOURCES,
  isCibaGenioResourceId,
  parseCibaGenioCommand,
  resolveCibaGenioAccess,
  type CibaGenioControl,
} from "../src/core/cibagenio";

const validAppId = (value: string) => /^[A-Za-z0-9_.]{3,150}$/.test(value);

describe("CibaGenio resource controls", () => {
  it("exposes a stable allowlisted resource catalog", () => {
    expect(CIBAGENIO_RESOURCES.map((resource) => resource.id)).toEqual([
      "chat",
      "persistent_memory",
      "app_messaging",
      "task_dispatch",
      "context_sharing",
      "multi_model_ensemble",
      "external_tools",
    ]);
    expect(isCibaGenioResourceId("chat")).toBe(true);
    expect(isCibaGenioResourceId("arbitrary_admin_action")).toBe(false);
  });

  it("parses global lock and unlock commands", () => {
    expect(parseCibaGenioCommand({ resource_id: "chat", enabled: true }, validAppId)).toEqual({
      valid: true,
      command: { resource_id: "chat", enabled: true, scope: "global" },
    });
    expect(parseCibaGenioCommand({
      resource_id: "external_tools",
      enabled: false,
      reason: "Aguardando revisão de segurança",
    }, validAppId)).toEqual({
      valid: true,
      command: {
        resource_id: "external_tools",
        enabled: false,
        scope: "global",
        reason: "Aguardando revisão de segurança",
      },
    });
  });

  it("requires a valid app id for app-scoped controls", () => {
    expect(parseCibaGenioCommand({
      resource_id: "chat", enabled: false, scope: "app", app_id: "com.ciba.app",
    }, validAppId)).toEqual({
      valid: true,
      command: { resource_id: "chat", enabled: false, scope: "app", app_id: "com.ciba.app" },
    });
    expect(parseCibaGenioCommand({
      resource_id: "chat", enabled: false, scope: "app",
    }, validAppId)).toEqual({ valid: false, error: "invalid_app_id" });
  });

  it("rejects unknown resources, invalid states, scopes and malformed reasons", () => {
    expect(parseCibaGenioCommand({ resource_id: "unknown", enabled: true }, validAppId))
      .toEqual({ valid: false, error: "unknown_resource" });
    expect(parseCibaGenioCommand({ resource_id: "chat", enabled: "yes" }, validAppId))
      .toEqual({ valid: false, error: "invalid_enabled" });
    expect(parseCibaGenioCommand({ resource_id: "chat", enabled: true, scope: "owner" }, validAppId))
      .toEqual({ valid: false, error: "invalid_scope" });
    expect(parseCibaGenioCommand({ resource_id: "chat", enabled: true, app_id: "com.ciba.app" }, validAppId))
      .toEqual({ valid: false, error: "unexpected_app_id" });
    expect(parseCibaGenioCommand({
      resource_id: "chat", enabled: true, reason: "x".repeat(301),
    }, validAppId)).toEqual({ valid: false, error: "invalid_reason" });
  });

  it("uses app overrides, then global state, and denies unconfigured resources", () => {
    const controls: CibaGenioControl[] = [
      { resource_id: "chat", scope: "global", scope_id: "", enabled: true },
      { resource_id: "chat", scope: "app", scope_id: "com.ciba.blocked", enabled: false },
      { resource_id: "persistent_memory", scope: "app", scope_id: "com.ciba.allowed", enabled: true },
    ];
    expect(resolveCibaGenioAccess("chat", "com.ciba.allowed", controls)).toBe(true);
    expect(resolveCibaGenioAccess("chat", "com.ciba.blocked", controls)).toBe(false);
    expect(resolveCibaGenioAccess("chat", undefined, controls)).toBe(true);
    expect(resolveCibaGenioAccess("persistent_memory", "com.ciba.other", controls)).toBe(false);
    expect(resolveCibaGenioAccess("external_tools", undefined, controls)).toBe(false);
    expect(resolveCibaGenioAccess("unknown", undefined, controls)).toBe(false);
  });
});
