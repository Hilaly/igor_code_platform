/**
 * Маршрутизатор запросов сессии: чем ходить и каким ключом (docs/model-routing.md).
 *
 * Правила выбора живут в `@sovereign/model-routing` — там они без рантайма и без файлов. Здесь
 * только то, чего тот пакет знать не может: как спросить у коллекции моделей провайдера и как
 * собрать авторизацию названного ключа.
 *
 * Один маршрутизатор на демон: здоровье ключей общее, иначе одна сессия учится на отказе, а
 * соседняя идёт в тот же отказ следом.
 */

import type { Models } from "@earendil-works/pi-ai";
import type { Candidate, KeyPool } from "@sovereign/model-routing";
import { aliasProviderId } from "@sovereign/protocol";

import type { CredentialVault } from "./credentials.ts";
import { processEnvironment, type Environment } from "./environment.ts";
import { resolveKeyAuth } from "./key-auth.ts";
import type { SessionRouter } from "./session-models.ts";

export type CreateModelRouterOptions = {
  /** Общий каталог: тот же, из которого сессия берёт модель. */
  models: Models;
  credentials: CredentialVault;
  pool: KeyPool;
  /** По умолчанию — настоящее окружение процесса. Подменяется только тестами. */
  environment?: Environment;
  /**
   * Кандидаты алиаса по порядку. `undefined` — такого алиаса нет; тогда сессия перебирает только
   * ключи провайдера самой модели.
   */
  aliasCandidates?: (aliasId: string) => Candidate[] | undefined;
  /** Сессия взялась за следующую попытку. Наблюдение: в дерево сессии это не пишется. */
  onSwitch?: SessionRouter["onSwitch"];
};

export function createModelRouter(options: CreateModelRouterOptions): SessionRouter {
  const environment = options.environment ?? processEnvironment();

  return {
    candidatesFor: (model) => {
      const itself = [{ providerId: model.provider, modelId: model.id }];

      if (model.provider !== aliasProviderId) {
        return itself;
      }

      // Алиас без кандидатов не подменяется на себя же: попытка сходить в псевдо-провайдера
      // кончится названным отказом, а не молчаливым запросом в никуда.
      return options.aliasCandidates?.(model.id) ?? itself;
    },
    keysOf: (providerId) =>
      options.pool.usable(
        providerId,
        options.credentials.keys(providerId).map((key) => key.id),
      ),
    lease: (providerId) =>
      options.pool.lease(
        providerId,
        options.credentials.keys(providerId).map((key) => key.id),
      ),
    authFor: (attempt) =>
      resolveKeyAuth({
        models: options.models,
        credentials: options.credentials,
        environment,
        providerId: attempt.candidate.providerId,
        keyId: attempt.keyId,
      }),
    report: (attempt, verdict) => {
      if (attempt.keyId !== undefined) {
        options.pool.report(attempt.candidate.providerId, attempt.keyId, verdict);
      }
    },
    ...(options.onSwitch === undefined ? {} : { onSwitch: options.onSwitch }),
  };
}
