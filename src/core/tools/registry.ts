import type { CibaToolDefinition, CibaToolRegistry, CibaToolRisk } from "./contracts";

const MAX_TOOLS = 64;
const MAX_SCHEMA_BYTES = 32_000;
const MAX_INPUT_BYTES = 64_000;
const MAX_OUTPUT_BYTES = 256_000;
const MAX_DEPTH = 12;
const DEFAULT_TIMEOUT_MS = 15_000;

export interface CibaToolExecutionContext {
  approvedToolIds?: string[];
  allowedScopes?: string[];
}

export interface CibaToolRegistryOptions {
  /** Explicit allowlist. An omitted or empty list registers no tools. */
  allowlist?: string[];
  timeoutMs?: number;
  maxInputBytes?: number;
  maxOutputBytes?: number;
}

export interface ExecutableCibaToolRegistry extends CibaToolRegistry {
  execute(toolId: string, input: unknown, context?: CibaToolExecutionContext): Promise<unknown>;
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
  if (depth > MAX_DEPTH) throw new Error("tool_schema_too_deep");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("invalid_tool_schema_number");
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => cloneJson(item, depth + 1));
  if (typeof value !== "object") throw new Error("invalid_tool_schema");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error("invalid_tool_schema");
  const result: Record<string, unknown> = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      throw new Error("invalid_tool_schema_key");
    }
    result[key] = cloneJson(item, depth + 1);
  }
  return result;
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
    if (rule.additionalProperties === false &&
        Object.keys(object).some((key) => !Object.prototype.hasOwnProperty.call(properties, key))) return false;
    if (typeof rule.maxProperties === "number" && Object.keys(object).length > rule.maxProperties) return false;
    return Object.entries(object).every(([key, item]) =>
      !Object.prototype.hasOwnProperty.call(properties, key) ||
      validateSchema(item, properties[key], depth + 1));
  }

  if (rule.type === "array") {
    if (!Array.isArray(value)) return false;
    if (typeof rule.maxItems === "number" && value.length > rule.maxItems) return false;
    if (typeof rule.minItems === "number" && value.length < rule.minItems) return false;
    return rule.items === undefined || value.every((item) => validateSchema(item, rule.items, depth + 1));
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
  return rule.type === undefined;
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
 * Creates an isolated registry. Nothing is executable unless its ID is
 * explicitly allowlisted by the integrating application.
 * Timeout bounds waiting; it cannot forcibly stop an already-running tool.
 */
export function createCibaToolRegistry(
  definitions: CibaToolDefinition[],
  options: CibaToolRegistryOptions = {}
): ExecutableCibaToolRegistry {
  const allowlist = new Set((options.allowlist ?? []).filter(validId));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxInputBytes = options.maxInputBytes ?? MAX_INPUT_BYTES;
  const maxOutputBytes = options.maxOutputBytes ?? MAX_OUTPUT_BYTES;

  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000 ||
      !Number.isInteger(maxInputBytes) || maxInputBytes < 1 || maxInputBytes > MAX_INPUT_BYTES ||
      !Number.isInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > MAX_OUTPUT_BYTES) {
    throw new Error("invalid_tool_registry_limits");
  }

  const registered = new Map<string, {
    definition: CibaToolDefinition;
    schema: Record<string, unknown>;
  }>();

  if (!Array.isArray(definitions) || definitions.length > MAX_TOOLS) {
    throw new Error("invalid_tool_definitions");
  }

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
             Object.prototype.hasOwnProperty.call(schema.properties, key))))) continue;

    registered.set(definition.id, {
      definition: Object.freeze({
        id: definition.id,
        description: definition.description,
        risk: definition.risk,
        requiresApproval: definition.requiresApproval,
        execute: definition.execute
      }),
      schema: Object.freeze(schema)
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
    async execute(toolId: string, input: unknown, context: CibaToolExecutionContext = {}) {
      const item = registered.get(toolId);
      if (!item) throw new Error("tool_not_allowlisted");
      if (item.definition.requiresApproval &&
          !context.approvedToolIds?.includes(toolId)) throw new Error("tool_approval_required");
      if (context.allowedScopes && !context.allowedScopes.includes(item.definition.risk)) {
        throw new Error("tool_scope_denied");
      }
      if (jsonBytes(input) > maxInputBytes || !validateSchema(input, item.schema)) {
        throw new Error("invalid_tool_input");
      }

      const safeInput = cloneJson(input);
      const output = await withTimeout(
        Promise.resolve().then(() => item.definition.execute(safeInput)),
        timeoutMs
      );
      if (jsonBytes(output) > maxOutputBytes) throw new Error("tool_output_too_large");
      return cloneJson(output);
    }
  });
}
