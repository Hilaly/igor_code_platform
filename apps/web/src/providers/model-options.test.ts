import type { ModelSummary, ProviderSummary } from "@sovereign/protocol";
import { describe, expect, it } from "vitest";

import { modelPickerGroups, selectedModel } from "./model-options.ts";
import type { ProviderModelsEntry as ModelsEntry } from "./state.ts";

const anthropic: ProviderSummary = {
  id: "anthropic",
  name: "Anthropic",
  logins: [],
  auth: { kind: "configured", type: "api_key" },
  keys: [],
  dynamic: false,
  custom: false,
  origin: "builtin",
  modelCount: 1,
};

const opus: ModelSummary = {
  id: "claude-opus-4-5",
  name: "Claude Opus 4.5",
  providerId: "anthropic",
  contextWindow: 200_000,
  maxTokens: 32_000,
  reasoning: true,
  input: ["text"],
  cost: { input: 3, output: 15 },
};

describe("the model picker options of the catalogue", () => {
  it("builds a ready provider catalogue", () => {
    const models: Record<string, ModelsEntry> = {
      anthropic: { kind: "ready", models: [opus] },
    };

    expect(modelPickerGroups([anthropic], models, "anthropic/claude-opus-4-5")).toEqual([
      {
        id: "anthropic",
        label: "Anthropic",
        loading: false,
        failureReason: undefined,
        options: [
          {
            value: "anthropic/claude-opus-4-5",
            label: "anthropic/claude-opus-4-5",
            description: "Claude Opus 4.5",
          },
        ],
      },
    ]);
    expect(selectedModel("anthropic/claude-opus-4-5", models)).toEqual(opus);
  });

  it("keeps the selected reference visible while its provider catalogue is loading", () => {
    const models: Record<string, ModelsEntry> = { anthropic: { kind: "loading" } };

    expect(modelPickerGroups([anthropic], models, "anthropic/claude-opus-4-5")).toEqual([
      {
        id: "anthropic",
        label: "Anthropic",
        loading: true,
        failureReason: undefined,
        options: [
          {
            value: "anthropic/claude-opus-4-5",
            label: "anthropic/claude-opus-4-5",
          },
        ],
      },
    ]);
    expect(selectedModel("anthropic/claude-opus-4-5", models)).toBeUndefined();
  });

  it("adds a synthetic group when the selected provider is absent from the snapshot", () => {
    expect(modelPickerGroups([], {}, "retired/model-v1")).toEqual([
      {
        id: "retired",
        label: "retired",
        loading: false,
        failureReason: undefined,
        options: [{ value: "retired/model-v1", label: "retired/model-v1" }],
      },
    ]);
    expect(selectedModel("retired/model-v1", {})).toBeUndefined();
  });

  it("preserves loading state for a selected provider missing from the provider list", () => {
    expect(modelPickerGroups([], { retired: { kind: "loading" } }, "retired/model-v1")).toEqual([
      {
        id: "retired",
        label: "retired",
        loading: true,
        failureReason: undefined,
        options: [{ value: "retired/model-v1", label: "retired/model-v1" }],
      },
    ]);
  });

  it("preserves failure state for a selected provider missing from the provider list", () => {
    expect(
      modelPickerGroups(
        [],
        { retired: { kind: "failed", reason: "catalog unavailable" } },
        "retired/model-v1",
      ),
    ).toEqual([
      {
        id: "retired",
        label: "retired",
        loading: false,
        failureReason: "catalog unavailable",
        options: [{ value: "retired/model-v1", label: "retired/model-v1" }],
      },
    ]);
  });

  it("uses a ready catalogue for a selected provider missing from the provider list", () => {
    const retiredModel: ModelSummary = {
      ...opus,
      providerId: "retired",
      id: "model-v2",
      name: "Model V2",
    };

    expect(
      modelPickerGroups(
        [],
        { retired: { kind: "ready", models: [retiredModel] } },
        "retired/model-v1",
      ),
    ).toEqual([
      {
        id: "retired",
        label: "retired",
        loading: false,
        failureReason: undefined,
        options: [
          {
            value: "retired/model-v2",
            label: "retired/model-v2",
            description: "Model V2",
          },
          { value: "retired/model-v1", label: "retired/model-v1" },
        ],
      },
    ]);
  });
});
