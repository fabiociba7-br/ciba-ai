import type { CibaToolDefinition, CibaToolRegistry, CibaToolRisk } from "./contracts";

const MAX_TOOLS = 64;
const MAX_SCHEMA_BYTES = 32_000;
const MAX_INPUT_BYTES = 64_000;
const MAX_OUTPUT_BYTES = 256_000;
const MAX_DEPTH = 12;
const MAX_JSON_NODES = 20_000;
const MAX_JSON_STRING_CHARS = MAX_OUTPUT_BYTES;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_CONCURRENT_EXECUTIONS = 8;

export interface CibaToolInvocationContext {
  conversationId: string;
  invocationId: string;
}

export interface CibaToolAuthorizationRequest {
  conversationId?: string;
  invocationId?: string;
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

export interface CibaToolInvocationPlan {
  conversationId?: string;
  invocationId?: string;
  toolId: string;
  risk: CibaToolRisk;
  requiresApproval: boolean;
  input: unknown;
}

export interface ExecutableCibaToolRegistry extends CibaToolRegistry {
  /** Validates and snapshots a proposed call without authorizing or executing it. */
  prepare(toolId: string, input: unknown, context?: CibaToolInvocationContext): CibaToolInvocationPlan;
  execute(toolId: string, input: unknown, context?: CibaToolInvocationContext): Promise<unknown>;
}

const VALID_RISKS: CibaToolRisk[] = ["read", "write", "external"];

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9._-]{0,63}$/.test(value);
}

function snapshotInvocationContext(value: unknown): CibaToolInvocationContext {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error("tool_invocation_context_required");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const allowed = new Set(["conversationId", "invocationId"]);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== 2 || keys.some((key) => typeof key !== "string" || !allowed.has(key))) {
    throw new Error("invalid_tool_invocation_context");
  }
  const fields: Record<string, unknown> = Object.create(null);
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error("invalid_tool_invocation_context");
    }
    fields[key] = descriptor.value;
  }
  if (typeof fields.conversationId !== "string" || !fields.conversationId.trim() ||
      fields.conversationId.length > 128 ||
      typeof fields.invocationId !== "string" || !fields.invocationId.trim() ||
      fields.invocationId.length > 128) {
    throw new Error("invalid_tool_invocation_context");
  }
  return Object.freeze({
    conversationId: fields.conversationId,
    invocationId: fields.invocationId
  });
}

function readPlainRecord(value: unknown, allowedKeys: string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) throw new Error("invalid_tool_definition");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string" || !allowedKeys.includes(key))) {
    throw new Error("invalid_tool_definition");
  }
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error("invalid_tool_definition");
    }
    result[key] = descriptor.value;
  }
  return result;
}

function snapshotDenseArray(value: unknown, maxLength: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > maxLength) throw new Error("invalid_tool_definitions");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== value.length + 1) {
    throw new Error("invalid_tool_definitions");
  }
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error("invalid_tool_definitions");
    }
    result.push(descriptor.value);
  }
  return result;
}

function jsonBytes(value: unknown): number {
  let serialized: string;
  try { serialized = JSON.stringify(value); }
  catch { throw new Error("tool_value_not_serializable"); }
  if (serialized === undefined) throw new Error("tool_value_not_serializable");
  return new TextEncoder().encode(serialized).byteLength;
}

interface JsonCloneBudget {
  nodes: number;
  stringChars: number;
}

function cloneJson(
  value: unknown,
  depth = 0,
  budget: JsonCloneBudget = { nodes: 0, stringChars: 0 }
): unknown {
  if (depth > MAX_DEPTH) throw new Error("tool_value_too_deep");
  budget.nodes += 1;
  if (budget.nodes > MAX_JSON_NODES) throw new Error("tool_value_too_complex");
  if (typeof value === "string") {
    budget.stringChars += value.length;
    if (budget.stringChars > MAX_JSON_STRING_CHARS) throw new Error("tool_value_too_large");
    return value;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("invalid_tool_value");
    return value;
  }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) throw new Error("invalid_tool_value");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const length = descriptors.length?.value;
    if (!Number.isInteger(length) || length < 0 || length > MAX_INPUT_BYTES) {
      throw new Error("invalid_tool_value");
    }
    if (Reflect.ownKeys(descriptors).length !== length + 1) throw new Error("invalid_tool_value");
    const result: unknown[] = new Array(length);
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new Error("invalid_tool_value");
      }
      result[index] = cloneJson(descriptor.value, depth + 1, budget);
    }
    return result;
  }
  if (typeof value !== "object") throw new Error("invalid_tool_value");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error("invalid_tool_value");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || key === "__proto__" ||
        key === "constructor" || key === "prototype") {
      throw new Error("invalid_tool_value");
    }
    const descriptor = descriptors[key];
    if (!("value" in descriptor) || !descriptor.enumerable) {
      throw new Error("invalid_tool_value");
    }
    budget.stringChars += key.length;
    if (budget.stringChars > MAX_JSON_STRING_CHARS) throw new Error("tool_value_too_large");
    result[key] = cloneJson(descriptor.value, depth + 1, budget);
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

function isValidSchemaDefinition(schema: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH || schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    return false;
  }
  const rule = schema as Record<string, unknown>;
  const type = rule.type;
  if (type === "object") {
    const allowed = new Set(["type", "properties", "required", "additionalProperties", "maxProperties"]);
    if (Object.keys(rule).some((key) => !allowed.has(key)) ||
        rule.additionalProperties !== false ||
        !rule.properties || typeof rule.properties !== "object" || Array.isArray(rule.properties) ||
        (rule.maxProperties !== undefined &&
          (!Number.isInteger(rule.maxProperties) || (rule.maxProperties as number) < 0))) return false;
    const properties = rule.properties as Record<string, unknown>;
    if (Object.keys(properties).length > 128 ||
        Object.keys(properties).some((key) => !key || key.length > 128 ||
          key === "__proto__" || key === "constructor" || key === "prototype" ||
          !isValidSchemaDefinition(properties[key], depth + 1))) return false;
    if (rule.required !== undefined &&
        (!Array.isArray(rule.required) || rule.required.length > 128 ||
          new Set(rule.required).size !== rule.required.length ||
          !rule.required.every((key) => typeof key === "string" &&
            Object.prototype.hasOwnProperty.call(properties, key)))) return false;
    return true;
  }
  if (type === "array") {
    const allowed = new Set(["type", "items", "minItems", "maxItems"]);
    return Object.keys(rule).every((key) => allowed.has(key)) &&
      isValidSchemaDefinition(rule.items, depth + 1) &&
      (rule.minItems === undefined || (Number.isInteger(rule.minItems) && (rule.minItems as number) >= 0)) &&
      (rule.maxItems === undefined || (Number.isInteger(rule.maxItems) && (rule.maxItems as number) >= 0)) &&
      (rule.minItems === undefined || rule.maxItems === undefined ||
        (rule.minItems as number) <= (rule.maxItems as number));
  }
  if (type === "string") {
    const allowed = new Set(["type", "minLength", "maxLength", "enum"]);
    if (Object.keys(rule).some((key) => !allowed.has(key)) ||
        (rule.minLength !== undefined && (!Number.isInteger(rule.minLength) || (rule.minLength as number) < 0)) ||
        (rule.maxLength !== undefined && (!Number.isInteger(rule.maxLength) || (rule.maxLength as number) < 0)) ||
        (rule.minLength !== undefined && rule.maxLength !== undefined &&
          (rule.minLength as number) > (rule.maxLength as number))) return false;
    return rule.enum === undefined ||
      (Array.isArray(rule.enum) && rule.enum.length <= 128 &&
        rule.enum.every((item) => typeof item === "string"));
  }
  if (type === "number" || type === "integer") {
    const allowed = new Set(["type", "minimum", "maximum", "enum"]);
    if (Object.keys(rule).some((key) => !allowed.has(key)) ||
        (rule.minimum !== undefined && (typeof rule.minimum !== "number" || !Number.isFinite(rule.minimum))) ||
        (rule.maximum !== undefined && (typeof rule.maximum !== "number" || !Number.isFinite(rule.maximum))) ||
        (rule.minimum !== undefined && rule.maximum !== undefined &&
          (rule.minimum as number) > (rule.maximum as number))) return false;
    return rule.enum === undefined ||
      (Array.isArray(rule.enum) && rule.enum.length <= 128 &&
        rule.enum.every((item) => typeof item === "number" && Number.isFinite(item) &&
          (type !== "integer" || Number.isInteger(item))));
  }
  if (type === "boolean" || type === "null") {
    return Object.keys(rule).every((key) => key === "type" || key === "enum") &&
      (rule.enum === undefined ||
        (Array.isArray(rule.enum) && rule.enum.length <= 2 &&
          rule.enum.every((item) => type === "null" ? item === null : typeof item === "boolean")));
  }
  return false;
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
  const optionFields = readPlainRecord(options, [
    "allowlist", "authorize", "timeoutMs", "maxInputBytes", "maxOutputBytes", "maxConcurrentExecutions"
  ]);
  const authorize = optionFields.authorize;
  if (typeof authorize !== "function") throw new Error("tool_authorizer_required");
  const rawAllowlist = optionFields.allowlist === undefined ? [] :
    snapshotDenseArray(optionFields.allowlist, MAX_TOOLS);
  if (!rawAllowlist.every(validId)) throw new Error("invalid_tool_allowlist");
  const allowlist = new Set(rawAllowlist as string[]);
  const timeoutMs = optionFields.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxInputBytes = optionFields.maxInputBytes ?? MAX_INPUT_BYTES;
  const maxOutputBytes = optionFields.maxOutputBytes ?? MAX_OUTPUT_BYTES;
  const maxConcurrentExecutions = optionFields.maxConcurrentExecutions ?? DEFAULT_MAX_CONCURRENT_EXECUTIONS;

  if (!Number.isInteger(maxConcurrentExecutions) || (maxConcurrentExecutions as number) < 1 ||
      (maxConcurrentExecutions as number) > 32 ||
      !Number.isInteger(timeoutMs) || (timeoutMs as number) < 100 || (timeoutMs as number) > 120_000 ||
      !Number.isInteger(maxInputBytes) || (maxInputBytes as number) < 1 || (maxInputBytes as number) > MAX_INPUT_BYTES ||
      !Number.isInteger(maxOutputBytes) || (maxOutputBytes as number) < 1 || (maxOutputBytes as number) > MAX_OUTPUT_BYTES) {
    throw new Error("invalid_tool_registry_limits");
  }
  const safeDefinitions = snapshotDenseArray(definitions, MAX_TOOLS);

  const registered = new Map<string, {
    definition: CibaToolDefinition;
    schema: Record<string, unknown>;
  }>();
  let activeExecutions = 0;

  for (const rawDefinition of safeDefinitions) {
    let fields: Record<string, unknown>;
    try {
      fields = readPlainRecord(rawDefinition, ["id", "description", "risk", "inputSchema", "requiresApproval", "execute"]);
    } catch { continue; }
    const id = fields.id;
    const description = fields.description;
    const risk = fields.risk;
    const requiresApproval = fields.requiresApproval;
    const execute = fields.execute;
    if (!validId(id) ||
        typeof description !== "string" ||
        description.trim().length === 0 ||
        description.length > 500 ||
        !VALID_RISKS.includes(risk as CibaToolRisk) ||
        typeof requiresApproval !== "boolean" ||
        typeof execute !== "function" ||
        (risk !== "read" && requiresApproval !== true) ||
        registered.has(id) ||
        !allowlist.has(id)) continue;

    let schema: Record<string, unknown>;
    try { schema = cloneJson(fields.inputSchema) as Record<string, unknown>; }
    catch { continue; }

    if (!schema || schema.type !== "object" ||
        !isValidSchemaDefinition(schema) ||
        jsonBytes(schema) > MAX_SCHEMA_BYTES ||
        (schema.required !== undefined &&
          (!Array.isArray(schema.required) ||
           !schema.required.every((key) => typeof key === "string" &&
             Object.prototype.hasOwnProperty.call(schema.properties, key)))) ||
        schema.additionalProperties !== false) continue;

    registered.set(id, {
      definition: Object.freeze({
        id,
        description,
        risk: risk as CibaToolRisk,
        inputSchema: deepFreeze(schema),
        requiresApproval,
        execute: execute as CibaToolDefinition["execute"]
      }),
      schema: deepFreeze(schema)
    });
  }

  return Object.freeze({
    get(toolId: string) {
      const definition = registered.get(toolId)?.definition;
      if (!definition) return undefined;
      return Object.freeze({
        id: definition.id,
        description: definition.description,
        risk: definition.risk,
        requiresApproval: definition.requiresApproval
      });
    },
    list() {
      return Array.from(registered.values(), ({ definition }) => Object.freeze({
        id: definition.id,
        description: definition.description,
        risk: definition.risk,
        requiresApproval: definition.requiresApproval
      }));
    },
    prepare(toolId: string, input: unknown, rawContext?: CibaToolInvocationContext) {
      const item = registered.get(toolId);
      if (!item) throw new Error("tool_not_allowlisted");
      const context = item.definition.requiresApproval
        ? snapshotInvocationContext(rawContext)
        : rawContext === undefined ? undefined : snapshotInvocationContext(rawContext);
      let safeInput: unknown;
      try {
        safeInput = cloneJson(input);
        if (jsonBytes(safeInput) > maxInputBytes) throw new Error("invalid_tool_input");
      } catch {
        throw new Error("invalid_tool_input");
      }
      if (!validateSchema(safeInput, item.schema)) throw new Error("invalid_tool_input");
      return Object.freeze({
        toolId,
        risk: item.definition.risk,
        requiresApproval: item.definition.requiresApproval,
        ...(context ?? {}),
        input: deepFreeze(safeInput)
      });
    },
    async execute(toolId: string, input: unknown, rawContext?: CibaToolInvocationContext) {
      const item = registered.get(toolId);
      if (!item) throw new Error("tool_not_allowlisted");
      const context = item.definition.requiresApproval
        ? snapshotInvocationContext(rawContext)
        : rawContext === undefined ? undefined : snapshotInvocationContext(rawContext);

      let safeInput: unknown;
      try {
        safeInput = cloneJson(input);
        if (jsonBytes(safeInput) > maxInputBytes) throw new Error("invalid_tool_input");
      } catch {
        throw new Error("invalid_tool_input");
      }
      if (!validateSchema(safeInput, item.schema)) throw new Error("invalid_tool_input");

      if (activeExecutions >= maxConcurrentExecutions) {
        throw new Error("tool_execution_capacity_reached");
      }
      activeExecutions += 1;
      const deadline = Date.now() + timeoutMs;
      const execution = Promise.resolve().then(async () => {
        const authorizationInput = deepFreeze(cloneJson(safeInput));
        const authorized = await authorize({
          toolId,
          risk: item.definition.risk,
          requiresApproval: item.definition.requiresApproval,
          ...(context ?? {}),
          input: authorizationInput
        });
        if (authorized !== true) throw new Error("tool_authorization_denied");
        // A delayed authorization must never start a side effect after the
        // caller's execution window has already expired.
        if (Date.now() >= deadline) throw new Error("tool_execution_timeout");

        const output = await item.definition.execute(cloneJson(safeInput));
        let safeOutput: unknown;
        try {
          safeOutput = cloneJson(output);
          if (jsonBytes(safeOutput) > maxOutputBytes) throw new Error("tool_output_too_large");
        } catch (error) {
          if (error instanceof Error && error.message === "tool_output_too_large") throw error;
          throw new Error("invalid_tool_output");
        }
        return safeOutput;
      });
      // Keep the capacity slot until the underlying operation actually settles,
      // even if the caller's timeout has already elapsed.
      execution.then(
        () => { activeExecutions -= 1; },
        () => { activeExecutions -= 1; }
      );
      return await withTimeout(execution, timeoutMs);
    }
  });
}
