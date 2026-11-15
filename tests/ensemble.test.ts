import { describe, expect, it, vi } from "vitest";
import { runMultiModelEnsemble, type EnsemblePlan } from "../src/core/ensemble";
import type { InferenceRequest, InferenceResult, ModelProvider } from "../src/core/types";

const provider = (id: string, response: string): ModelProvider => ({
  id,
  enabled: true,
  generate: vi.fn(async (request: InferenceRequest): Promise<InferenceResult> => ({
    text: response,
    raw: {},
    provider: id,
    model: request.model
  }))
});

const makePlan = (): EnsemblePlan => ({
  enabled: true,
  members: [
    { role: "reasoning", model: "model-a", provider: provider("provider-a", "Análise lógica."), zeroCostApproved: true },
    { role: "verification", model: "model-b", provider: provider("provider-b", "Pontos a verificar."), zeroCostApproved: true }
  ],
  synthesisProvider: provider("provider-c", "Síntese final."),
  synthesisModel: "model-c",
  synthesisZeroCostApproved: true,
  maxAgentCalls: 2,
  maxOutputTokens: 64,
  maxTotalOutputTokens: 192
});

describe("multi-model ensemble", () => {
  it("runs only distinct, explicitly zero-cost-approved models within the aggregate budget", async () => {
    const plan = makePlan();
    const result = await runMultiModelEnsemble({
      messages: [{ role: "user", content: "Compare estas alternativas." }],
      plan
    });

    expect(result.strategy).toBe("multi-model-ensemble");
    expect(result.inferenceCalls).toBe(3);
    expect(result.requestedOutputTokenBudget).toBe(192);
    expect(result.contributors).toHaveLength(2);
    expect(result.text).toBe("Síntese final.");
  });

  it("does not execute providers when collaboration is disabled", async () => {
    const plan = makePlan();
    plan.enabled = false;
    await expect(runMultiModelEnsemble({
      messages: [{ role: "user", content: "Teste." }],
      plan
    })).rejects.toThrow("multi_model_disabled");
    expect(plan.members[0].provider.generate).not.toHaveBeenCalled();
  });

  it("rejects models without explicit zero-cost approval", async () => {
    const plan = makePlan();
    plan.members[0].zeroCostApproved = false;
    await expect(runMultiModelEnsemble({
      messages: [{ role: "user", content: "Teste." }],
      plan
    })).rejects.toThrow("invalid_ensemble_member");
  });

  it("rejects an ensemble that does not contain distinct models", async () => {
    const plan = makePlan();
    plan.synthesisModel = "model-a";
    plan.synthesisProvider = plan.members[0].provider;
    plan.members = [plan.members[0]];
    await expect(runMultiModelEnsemble({
      messages: [{ role: "user", content: "Teste." }],
      plan
    })).rejects.toThrow("ensemble_requires_distinct_models");
  });

  it("rejects an aggregate output budget above the hard ceiling", async () => {
    const plan = makePlan();
    plan.maxTotalOutputTokens = 2_049;
    await expect(runMultiModelEnsemble({
      messages: [{ role: "user", content: "Teste." }],
      plan
    })).rejects.toThrow("invalid_ensemble_total_budget");
  });

  it("rejects oversized input before invoking providers", async () => {
    const plan = makePlan();
    await expect(runMultiModelEnsemble({
      messages: [{ role: "user", content: "x".repeat(3_001) }],
      plan
    })).rejects.toThrow("ensemble_input_too_large");
    expect(plan.members[0].provider.generate).not.toHaveBeenCalled();
  });
});
