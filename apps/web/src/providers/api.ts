/**
 * Запросы вью провайдеров. Каталог живёт в агентном рантайме за демоном
 * (docs/models-and-providers.md), поэтому вью только спрашивает: своей копии ни провайдеров, ни
 * моделей у него нет.
 *
 * Моделей больше тысячи на все провайдеры (docs/web-api.md), и в снимке их нет вовсе: список моделей
 * спрашивается по одному провайдеру.
 */

import {
  providerModelsPath,
  providersPath,
  type ProviderModels,
  type ProvidersSnapshot,
} from "@sovereign/protocol";

export async function fetchProvidersSnapshot(signal?: AbortSignal): Promise<ProvidersSnapshot> {
  const response = await fetch(providersPath, signal === undefined ? {} : { signal });

  // Негодный файл кредов сюда не приходит отказом: он приезжает полем `problem` внутри снимка
  // (docs/web-api.md). Отказ здесь означает, что не отвечает сам маршрут.
  if (!response.ok) {
    throw new Error(await reasonOf(response));
  }

  return (await response.json()) as ProvidersSnapshot;
}

export async function fetchProviderModels(
  providerId: string,
  signal?: AbortSignal,
): Promise<ProviderModels> {
  const response = await fetch(
    providerModelsPath(providerId),
    signal === undefined ? {} : { signal },
  );

  if (!response.ok) {
    throw new Error(await reasonOf(response));
  }

  return (await response.json()) as ProviderModels;
}

/** Демон отвечает `{"error"}` на любой отказ (docs/web-api.md), но код без тела тоже возможен. */
async function reasonOf(response: Response): Promise<string> {
  const failure = (await response.json().catch(() => ({}))) as { error?: string };

  return failure.error ?? `the daemon answered ${response.status}`;
}
