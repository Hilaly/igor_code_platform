/**
 * Интерактивный вход через веб-API (docs/web-api.md, docs/models-and-providers.md).
 *
 * Маршруты своего состояния не держат: попытки живут в `provider-logins.ts`, шаги уезжают кадром
 * потока. Кадр отдаётся **только попытке этой стороны**: у попытки плагина шаги едут в его воркер,
 * и второй отвечающий на один вопрос сломал бы диалог.
 */

import {
  parseLoginAnswer,
  parseLoginStart,
  providerLoginAnswerPathPattern,
  providerLoginPathPattern,
  providerLoginsPath,
  type LoginAttemptsSnapshot,
} from "@sovereign/protocol";

import type { CredentialStore } from "./credential-store.ts";
import { respondWithError, respondWithJson, type Route } from "./dispatcher.ts";
import type { EventStream } from "./event-stream.ts";
import type { ProviderLogins } from "./provider-logins.ts";

export type ProviderLoginRoutesOptions = {
  logins: ProviderLogins;
  credentials: Pick<CredentialStore, "problem">;
};

export function providerLoginRoutes(options: ProviderLoginRoutesOptions): Route[] {
  const { logins } = options;

  return [
    {
      method: "GET",
      path: providerLoginsPath,
      handle: ({ response }) => {
        // Попытка плагина здесь тоже видна: иначе провайдер выглядел бы занятым без причины.
        const snapshot: LoginAttemptsSnapshot = { attempts: logins.list() };

        respondWithJson(response, 200, snapshot);
      },
    },
    {
      method: "POST",
      path: providerLoginsPath,
      handle: ({ response, body, session }) => {
        const parsed = parseLoginStart(body);

        if (parsed.kind === "rejected") {
          respondWithError(response, 400, parsed.diagnostics.join("; "));

          return;
        }

        // Вход кончается записью креда, а поверх негодного файла платформа не пишет: начинать
        // диалог, который заведомо не сможет сохранить результат, значит тратить время человека.
        const problem = options.credentials.problem();

        if (problem !== undefined) {
          respondWithError(response, 409, problem);

          return;
        }

        const outcome = logins.start({
          providerId: parsed.value.providerId,
          method: parsed.value.method,
          origin: "session",
          owner: session?.id ?? "",
        });

        if (outcome.kind === "taken") {
          respondWithJson(response, 409, {
            error: `a login into ${parsed.value.providerId} is already running`,
            conflict: outcome.conflict,
          });

          return;
        }

        respondWithJson(response, 200, outcome.attempt);
      },
    },
    {
      method: "POST",
      path: providerLoginAnswerPathPattern,
      handle: ({ response, body, parameters, session }) => {
        const parsed = parseLoginAnswer(body);

        if (parsed.kind === "rejected") {
          respondWithError(response, 400, parsed.diagnostics.join("; "));

          return;
        }

        const answered = logins.answer(
          parameters["attemptId"] ?? "",
          parsed.value.stepId,
          parsed.value.value,
          session?.id ?? "",
        );

        switch (answered.kind) {
          case "answered":
            respondWithJson(response, 200, {});

            return;
          case "unknown":
            respondWithError(response, 404, "not found");

            return;
          case "stale":
            // Не ошибка запроса: человек отправил форму дважды или ответил на прошлый вопрос.
            respondWithError(response, 409, "that login step is no longer waiting for an answer");

            return;
          case "notYours":
            respondWithError(response, 409, "that login belongs to somebody else");

            return;
        }
      },
    },
    {
      method: "DELETE",
      path: providerLoginPathPattern,
      handle: ({ response, parameters, session }) => {
        const cancelled = logins.cancel(parameters["attemptId"] ?? "", session?.id ?? "");

        if (!cancelled) {
          respondWithError(response, 404, "not found");

          return;
        }

        respondWithJson(response, 200, {});
      },
    },
  ];
}

export type CarryLoginStepsOptions = {
  logins: ProviderLogins;
  events: Pick<EventStream, "emit">;
};

/**
 * Кадры шагов в поток. Реестр про SSE не знает — он про диалог, — а поток не знает про вход.
 * Возвращает функцию отписки.
 */
export function carryLoginSteps(options: CarryLoginStepsOptions): () => void {
  return options.logins.subscribe((attempt, step) => {
    // Шаги попытки плагина едут в его воркер и никуда больше: окажись они ещё и в потоке, у
    // одного вопроса стало бы два отвечающих (docs/models-and-providers.md).
    if (attempt.origin !== "session") {
      return;
    }

    options.events.emit({
      attemptId: attempt.attemptId,
      providerId: attempt.providerId,
      step,
    });
  });
}
