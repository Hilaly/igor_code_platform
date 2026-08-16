/**
 * Каталог провайдеров и их моделей — группами пикера. Живёт рядом с провайдерами, а не с сессиями:
 * спрашивающих больше одного — композер выбирает модель следующего турна, страница алиасов —
 * кандидата, — и обе стороны говорят о каталоге, а не о разговоре.
 *
 * Ссылка на модель, которой в каталоге нет, остаётся в списке отдельной опцией: провайдер мог
 * уехать вместе с плагином, а выбранное молча подменять нельзя (docs/model-routing.md).
 */

import {
  modelReference,
  parseModelReference,
  type ModelSummary,
  type ProviderSummary,
} from "@sovereign/protocol";
import type { ModelPickerGroup, ModelPickerOption } from "@sovereign/ui-kit";

import type { ProviderModelsEntry as ModelsEntry } from "./state.ts";

const referenceOption = (reference: string): ModelPickerOption => ({
  value: reference,
  label: reference,
});

function modelOptions(providerId: string, entry: ModelsEntry | undefined): ModelPickerOption[] {
  return entry?.kind === "ready"
    ? entry.models.map((model) => ({
        value: modelReference(providerId, model.id),
        label: modelReference(providerId, model.id),
        description: model.name,
      }))
    : [];
}

function modelGroupState(
  entry: ModelsEntry | undefined,
): Pick<ModelPickerGroup, "loading" | "failureReason"> {
  return {
    loading: entry?.kind === "loading",
    failureReason: entry?.kind === "failed" ? entry.reason : undefined,
  };
}

export function modelPickerGroups(
  providers: ProviderSummary[] | undefined,
  models: Record<string, ModelsEntry>,
  selectedReference: string | undefined,
): ModelPickerGroup[] {
  const selected =
    selectedReference === undefined ? undefined : parseModelReference(selectedReference);
  const groups = (providers ?? []).map((provider): ModelPickerGroup => {
    const entry = models[provider.id];
    const options = modelOptions(provider.id, entry);

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
      ...modelGroupState(entry),
      options,
    };
  });

  if (
    selectedReference !== undefined &&
    selected !== undefined &&
    !groups.some((group) => group.id === selected.providerId)
  ) {
    const entry = models[selected.providerId];
    const options = modelOptions(selected.providerId, entry);

    groups.push({
      id: selected.providerId,
      label: selected.providerId,
      ...modelGroupState(entry),
      options: options.some((option) => option.value === selectedReference)
        ? options
        : [...options, referenceOption(selectedReference)],
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
