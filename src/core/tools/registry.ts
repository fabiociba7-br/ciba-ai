import type { CibaToolDefinition, CibaToolRegistry, CibaToolRisk } from "./contracts";

const MAX_TOOLS = 64;
const MAX_SCHEMA_BYTES = 32_000;
const MAX_INPUT_BYTES = 64_000;
const MAX_OUTPUT_BYTES = 256_000;
const MAX_DEPTH = 12;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_CONCURRENT_EXECUTIONS = 8;

export interface CibaToolAuthorizationRequest {
  toolId: string;
  risk: CibaToolRisk;
  requiresApproval: boolean;
  input: unknown;
}

export interface CibaToolRegistryOptions {
  /** Explicit allowlist. An omitted or empty list registers no tools. */
  allowlist?: string[];
  /** Trusted application callback; it must verify identity, scopes and approval. */
  authorize: (request: CibaToolAuthorizationRequest) => boolean | Promise<boolean>;
  timeoutMs?: number;
  maxInputBytes?: number;
  maxOutputBytes?: number;
  maxConcurrentExecutions?: number;
}

export interface ExecutableCibaToolRegistry extends CibaToolRegistry {
  execute(toolId: string, input: unknown): Promise<unknown>;
}

const VALID_RISKS: CibaToolRisk[] = ["read", "write", "external"];

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9._-]{0,63}$/.test(value);
}

function jsonBytes(value: unknown): number {
  let serialized: string;
  try { serialized = JSON.stringify(value); }
  catch { throw new Error("tool_value_not_serializable"); }
  if (serialized === undefined) throw new Error("tool_value_not_serializable");
  return new TextEncoder().encode(serialized).byteLength;
}

function cloneJson(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) throw new Error("tool_value_too_deep");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("invalid_tool_value");
    return value;
  }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) throw new Error("invalid_tool_value");
    return value.map((item) => cloneJson(item, depth + 1));
  }
  if (typeof value !== "object") throw new Error("invalid_tool_value");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error("invalid_tool_value");
  const result: Record<string, unknown> = Object.create(null);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (key === "__proto__" || key === "constructor" || key === "prototype" ||
        !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error("invalid_tool_value");
    }
    result[key] = cloneJson(descriptor.value, depth + 1);
  }
  return result;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function validateSchema(value: unknown, schema: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH || !schema || typeof schema !== "object" || Array.isArray(schema)) return false;
  const rule = schema as Record<string, unknown>;
  if (Array.isArray(rule.enum) && !rule.enum.some((item) => Object.is(item, value))) return false;

  if (rule.type === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const object = value as Record<string, unknown>;
    const properties = (rule.properties ?? {}) as Record<string, unknown>;
    if (!properties || typeof properties !== "object" || Array.isArray(properties)) return false;
    if (Array.isArray(rule.required) &&
        !rule.required.every((key) => typeof key === "string" &&
          Object.prototype.hasOwnProperty.call(object, key))) return false;
    if (rule.additionalProperties !== false &&
        Object.keys(object).some((key) => !Object.prototype.hasOwnProperty.call(properties, key))) return false;
    if (typeof rule.maxProperties === "number" && Object.keys(object).length > rule.maxProperties) return false;
    return Object.entries(object).every(([key, item]) =>
      Object.prototype.hasOwnProperty.call(properties, key) &&
      validateSchema(item, properties[key], depth + 1));
  }

  if (rule.type === "array") {
    if (!Array.isArray(value)) return false;
    if (typeof rule.maxItems === "number" && value.length > rule.maxItems) return false;
    if (typeof rule.minItems === "number" && value.length < rule.minItems) return false;
    return rule.items !== undefined && value.every((item) => validateSchema(item, rule.items, depth + 1));
  }

  if (rule.type === "string") {
    if (typeof value !== "string") return false;
    if (typeof rule.maxLength === "number" && value.length > rule.maxLength) return false;
    if (typeof rule.minLength === "number" && value.length < rule.minLength) return false;
    if (typeof rule.pattern === "string") {
      try { if (!new RegExp(rule.pattern).test(value)) return false; }
      catch { return false; }
    }
    return true;
  }

  if (rule.type === "number" || rule.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    if (rule.type === "integer" && !Number.isInteger(value)) return false;
    if (typeof rule.minimum === "number" && value < rule.minimum) return false;
    if (typeof rule.maximum === "number" && value > rule.maximum) return false;
    return true;
  }

  if (rule.type === "boolean") return typeof value === "boolean";
  if (rule.type === "null") return value === null;
  return false;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("tool_execution_timeout")), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

/**
 * No tool is executable without both an explicit ID allowlist and a trusted
 * application authorization callback. Timeout bounds waiting; it cannot
 * forcibly stop an already-running tool.
 */
export function createCibaToolRegistry(
  definitions: CibaToolDefinition[],
  options: CibaToolRegistryOptions
): ExecutableCibaToolRegistry {
  if (!options || typeof options.authorize !== "function") {
    throw new Error("tool_authorizer_required");
  }
  const authorize = options.authorize;
  const allowlist = new Set((options.allowlist ?? []).filter(validId));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxInputBytes = options.maxInputBytes ?? MAX_INPUT_BYTES;
  const maxOutputBytes = options.maxOutputBytes ?? MAX_OUTPUT_BYTES;
  const maxConcurrentExecutions = options.maxConcurrentExecutions ?? DEFAULT_MAX_CONCURRENT_EXECUTIONS;

  if (!Number.isInteger(maxConcurrentExecutions) || maxConcurrentExecutions < 1 ||
      maxConcurrentExecutions > 32 ||
      !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000 ||
      !Number.isInteger(maxInputBytes) || maxInputBytes < 1 || maxInputBytes > MAX_INPUT_BYTES ||
      !Number.isInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > MAX_OUTPUT_BYTES) {
    throw new Error("invalid_tool_registry_limits");
  }
  if (!Array.isArray(definitions) || definitions.length > MAX_TOOLS) {
    throw new Error("invalid_tool_definitions");
  }

  const registered = new Map<string, {
    definition: CibaToolDefinition;
    schema: Record<string, unknown>;
  }>();
  let activeExecutions = 0;

  for (const definition of definitions) {
    if (!definition || typeof definition !== "object" ||
        !validId(definition.id) ||
        typeof definition.description !== "string" ||
        definition.description.trim().length === 0 ||
        definition.description.length > 500 ||
        !VALID_RISKS.includes(definition.risk) ||
        typeof definition.requiresApproval !== "boolean" ||
        typeof definition.execute !== "function" ||
        registered.has(definition.id) ||
        !allowlist.has(definition.id)) continue;

    let schema: Record<string, unknown>;
    try { schema = cloneJson(definition.inputSchema) as Record<string, unknown>; }
    catch { continue; }

    if (!schema || schema.type !== "object" ||
        !schema.properties || typeof schema.properties !== "object" ||
        Array.isArray(schema.properties) ||
        jsonBytes(schema) > MAX_SCHEMA_BYTES ||
        (schema.required !== undefined &&
          (!Array.isArray(schema.required) ||
           !schema.required.every((key) => typeof key === "string" &&
             Object.prototype.hasOwnProperty.call(schema.properties, key)))) ||
        schema.additionalProperties !== false) continue;

    registered.set(definition.id, {
      definition: Object.freeze({
        id: definition.id,
        description: definition.description,
        risk: definition.risk,
        inputSchema: deepFreeze(schema),
        requiresApproval: definition.requiresApproval,
        execute: definition.execute
      }),
      schema: deepFreeze(schema)
    });
  }

  return Object.freeze({
    get(toolId: string) { return registered.get(toolId)?.definition; },
    list() {
      return Array.from(registered.values(), ({ definition }) => Object.freeze({
        id: definition.id,
        description: definition.description,
        risk: definition.risk,
        requiresApproval: definition.requiresApproval
      }));
    },
    async execute(toolId: string, input: unknown) {
      const item = registered.get(toolId);
      if (!item) throw new Error("tool_not_allowlisted");

      let safeInput: unknown;
      try {
        safeInput = cloneJson(input);
        if (jsonBytes(safeInput) > maxInputBytes) throw new Error("invalid_tool_input");
      } catch {
        throw new Error("invalid_tool_input");
      }
      if (!validateSchema(safeInput, item.schema)) throw new Error("invalid_tool_input");

      const authorized = await withTimeout(
        Promise.resolve().then(() => authorize({
          toolId,
          risk: item.definition.risk,
          requiresApproval: item.definition.requiresApproval,
          input: safeInput
        })),
        timeoutMs
      );
      if (authorized !== true) throw new Error("tool_authorization_denied");

      if (activeExecutions >= maxConcurrentExecutions) {
        throw new Error("tool_execution_capacity_reached");
      }
      activeExecutions += 1;
      const execution = Promise.resolve().then(() => item.definition.execute(safeInput));
      execution.then(
        () => { activeExecutions -= 1; },
        () => { activeExecutions -= 1; }
      );
      const output = await withTimeout(execution, timeoutMs);
      let safeOutput: unknown;
      try {
        safeOutput = cloneJson(output);
        if (jsonBytes(safeOutput) > maxOutputBytes) throw new Error("tool_output_too_large");
      } catch (error) {
        if (error instanceof Error && error.message === "tool_output_too_large") throw error;
        throw new Error("invalid_tool_output");
      }
      return safeOutput;
    }
  });
}
