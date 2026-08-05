import {
  modelReference,
  parseModelReference,
  type ModelSummary,
  type ProviderSummary,
} from "@sovereign/protocol";
import type { ModelPickerGroup, ModelPickerOption } from "@sovereign/ui-kit";

import type { ModelsEntry } from "./state.ts";

const referenceOption = (reference: string): ModelPickerOption => ({
  value: reference,
  label: reference,
});

export function modelPickerGroups(
  providers: ProviderSummary[] | undefined,
  models: Record<string, ModelsEntry>,
  selectedReference: string | undefined,
): ModelPickerGroup[] {
  const selected =
    selectedReference === undefined ? undefined : parseModelReference(selectedReference);
  const groups = (providers ?? []).map((provider): ModelPickerGroup => {
    const entry = models[provider.id];
    const options: ModelPickerOption[] =
      entry?.kind === "ready"
        ? entry.models.map((model) => ({
            value: modelReference(provider.id, model.id),
            label: modelReference(provider.id, model.id),
            description: model.name,
          }))
        : [];

    if (
      selectedReference !== undefined &&
      selected?.providerId === provider.id &&
      !options.some((option) => option.value === selectedReference)
    ) {
      options.push(referenceOption(selectedReference));
    }

    return {
      id: provider.id,
      label: provider.name,
      loading: entry?.kind === "loading",
      failureReason: entry?.kind === "failed" ? entry.reason : undefined,
      options,
    };
  });

  if (
    selectedReference !== undefined &&
    selected !== undefined &&
    !groups.some((group) => group.id === selected.providerId)
  ) {
    groups.push({
      id: selected.providerId,
      label: selected.providerId,
      loading: false,
      failureReason: undefined,
      options: [referenceOption(selectedReference)],
    });
  }

  return groups;
}

export function selectedModel(
  reference: string | undefined,
  models: Record<string, ModelsEntry>,
): ModelSummary | undefined {
  const parsed = reference === undefined ? undefined : parseModelReference(reference);

  if (parsed === undefined) {
    return undefined;
  }

  const entry = models[parsed.providerId];
  return entry?.kind === "ready"
    ? entry.models.find((model) => model.id === parsed.modelId)
    : undefined;
}
