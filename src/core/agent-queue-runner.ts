import type { D1Database } from "@cloudflare/workers-types";
import {
  claimAgentJob,
  heartbeatAgentJob,
  completeAgentJob,
  failAgentJob,
} from "./agent-queue-store";
import { runCibaOrchestrator } from "./orchestrator";
import { CloudflareWorkersAIProvider, type CloudflareAI } from "./providers/cloudflare";
import type { ChatTurn } from "./types";

const MAX_JOB_MESSAGES = 20;
const MAX_JOB_TEXT_CHARS = 12_000;
const MAX_JOB_OUTPUT_TOKENS = 512;
const HEARTBEAT_INTERVAL_MS = 25_000;

function parseJobMessages(payloadJson: string): ChatTurn[] {
  const payload: unknown = JSON.parse(payloadJson);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("invalid_agent_job_payload");
  }
  const record = payload as Record<string, unknown>;
  let messages: unknown[];
  if (Array.isArray(record.messages)) {
    messages = record.messages;
  } else if (typeof record.prompt === "string") {
    messages = [{ role: "user", content: record.prompt }];
  } else {
    throw new Error("invalid_agent_job_payload");
  }
  if (messages.length < 1 || messages.length > MAX_JOB_MESSAGES) {
    throw new Error("invalid_agent_job_messages");
  }
  const safe: ChatTurn[] = [];
  let total = 0;
  for (const item of messages) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("invalid_agent_job_message");
    }
    const message = item as Record<string, unknown>;
    if ((message.role !== "user" && message.role !== "assistant") ||
        typeof message.content !== "string" ||
        message.content.length > MAX_JOB_TEXT_CHARS) {
      throw new Error("invalid_agent_job_message");
    }
    total += message.content.length;
    if (total > MAX_JOB_TEXT_CHARS) throw new Error("agent_job_input_too_large");
    safe.push({ role: message.role, content: message.content });
  }
  if (!safe.some((message) => message.role === "user")) {
    throw new Error("agent_job_user_message_required");
  }
  return safe;
}

/**
 * Processes at most one durable job per invocation. Callers use waitUntil so
 * queue work never delays the API response. All inference remains on the
 * already-configured Workers AI binding and configured free/approved model.
 */
export async function runOneAgentQueueJob(
  db: D1Database,
  ai: CloudflareAI,
  model: string,
): Promise<boolean> {
  const claim = await claimAgentJob(db, new Date().toISOString());
  if (!claim) return false;

  let heartbeatLost = false;
  const timer = setInterval(() => {
    void heartbeatAgentJob(db, claim.task_id, claim.lease_token, new Date().toISOString())
      .then((ok) => { if (!ok) heartbeatLost = true; })
      .catch(() => { heartbeatLost = true; });
  }, HEARTBEAT_INTERVAL_MS);

  try {
    const messages = parseJobMessages(claim.payload_json);
    const provider = new CloudflareWorkersAIProvider(ai);
    const result = await runCibaOrchestrator({
      messages,
      model,
      maxOutputTokens: MAX_JOB_OUTPUT_TOKENS,
      provider,
      agentRole: claim.agent_role,
    });
    if (heartbeatLost) return false;
    const resultJson = JSON.stringify({
      text: result.text,
      agent_role: claim.agent_role,
      selected_agent: result.selectedAgent,
      provider: result.provider,
      model: result.model,
      strategy: result.strategy,
      used_inference_calls: result.usedInferenceCalls,
    });
    return await completeAgentJob(
      db, claim.task_id, claim.lease_token, resultJson, new Date().toISOString(),
    );
  } catch (error) {
    const code = error instanceof Error && /^[a-z0-9_]{1,100}$/.test(error.message)
      ? error.message
      : "agent_execution_failed";
    await failAgentJob(db, claim.task_id, claim.lease_token, code, new Date().toISOString());
    return false;
  } finally {
    clearInterval(timer);
  }
}
