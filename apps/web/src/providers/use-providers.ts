/**
 * Связь вью провайдеров с демоном: снимок на подъёме соединения, модели по раскрытию строки, вход и
 * выход по нажатию. Своего потока вью не открывает — соединение одно на вкладку (docs/web-api.md).
 *
 * Шаги входа приезжают не шиной, а отдельным кадром того же соединения: шаг адресован одному
 * инициатору и ждёт ответа (docs/models-and-providers.md). Поэтому кадр приходит сюда вызовом
 * `receiveLoginStep`, а не подпиской.
 *
 * На подъёме соединения спрашивается и снимок попыток входа: кадр мог уехать в разрыв, и диалог
 * восстанавливается снимком, а не окном догона.
 */

import type {
  LoginKeyTarget,
  LoginStepFrame,
  ModelAlias,
  ProviderAuthType,
} from "@sovereign/protocol";
import { useCallback, useEffect, useRef, useState } from "react";

import type { FrontendBus } from "../events/bus.ts";
import type { StreamStatus } from "../events/stream.ts";
import {
  answerLoginStep,
  cancelProviderLogin,
  deleteModelAlias,
  fetchLoginAttempts,
  fetchModelAliases,
  fetchProviderModels,
  fetchProvidersSnapshot,
  fetchUserProviders,
  logOutProvider,
  removeProviderKey,
  saveModelAlias,
  startProviderLogin,
  updateProviderKey,
} from "./api.ts";
import {
  applyAnswered,
  applyAnswerFailure,
  applyAttempts,
  applyLoginStep,
  applyLogout,
  applyStaleAnswer,
  applyStarted,
  applyStartFailure,
  applyTaken,
  closeLoginDialog,
  type LoginsState,
} from "./login-state.ts";
import {
  applyAliasesSnapshot,
  applyFailure,
  applyModels,
  applyModelsFailure,
  applySnapshot,
  applyStreamEvent,
  applyUserProvidersSnapshot,
  initialProvidersState,
  markModelsLoading,
  shouldFetchModels,
  type ProvidersState,
} from "./state.ts";

export type UseProvidersOptions = {
  bus: Pick<FrontendBus, "subscribe">;
  stream: StreamStatus;
  onDiagnostic: (diagnostic: string) => void;
  /**
   * Провайдер, чья страница открыта. Модели спрашиваются по этому идентификатору, а не по жесту
   * раскрытия строки: адрес — единственный источник истины (docs/models-and-providers.md).
   */
  providerId?: string;
};

export type ProvidersController = {
  state: ProvidersState;
  /**
   * Начать вход. Цель называет ключ, в который ляжет кред: не названа — вход добавит ключ
   * (docs/models-and-providers.md).
   */
  logIn: (providerId: string, method: ProviderAuthType, target?: LoginKeyTarget) => void;
  /** Ответ на текущий вопрос. Попытку хук находит сам: на провайдера её не больше одной. */
  answer: (providerId: string, stepId: string, value: string) => void;
  cancelLogin: (providerId: string) => void;
  /** Убрать с экрана диалог, который уже ничем не кончится. */
  closeLogin: (providerId: string) => void;
  logOut: (providerId: string) => void;
  /** Переименовать ключ провайдера. */
  renameKey: (providerId: string, keyId: string, label: string) => Promise<void>;
  /** Сделать ключ тем, которым провайдер представлен целиком. */
  selectKey: (providerId: string, keyId: string) => Promise<void>;
  /** Убрать один ключ. Остальные остаются, и провайдер остаётся настроенным. */
  removeKey: (providerId: string, keyId: string) => Promise<void>;
  /** Завести алиас или заменить существующий (docs/model-routing.md). */
  saveAlias: (alias: ModelAlias, existing: boolean) => Promise<void>;
  removeAlias: (aliasId: string) => Promise<void>;
  /** Кадр шага входа из потока. Не событие шины (docs/models-and-providers.md). */
  receiveLoginStep: (frame: LoginStepFrame) => void;
};

const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export function useProviders(options: UseProvidersOptions): ProvidersController {
  const { bus, stream, onDiagnostic, providerId } = options;
  const [state, setState] = useState<ProvidersState>(initialProvidersState);

  // То же зеркало, что во вью проектов: правило применения смотрит на предыдущее состояние, а ответы
  // приходят чаще, чем React успевает отрисовать. Единственный источник изменения — `apply`.
  const latest = useRef<ProvidersState>(initialProvidersState);
  const apply = useCallback((next: (current: ProvidersState) => ProvidersState) => {
    latest.current = next(latest.current);
    setState(latest.current);
  }, []);

  /** Правила диалогов написаны на своём состоянии, а живёт оно полем провайдерского. */
  const applyToLogins = useCallback(
    (next: (current: LoginsState) => LoginsState) =>
      apply((current) => ({ ...current, logins: next(current.logins) })),
    [apply],
  );

  const pendingSnapshot = useRef<AbortController | undefined>(undefined);
  const pendingAttempts = useRef<AbortController | undefined>(undefined);
  // Запросы моделей не отменяют друг друга: каждый ответ ложится в свою запись по провайдеру, и
  // разойтись им негде. Отменённый на полпути оставил бы провайдера с вечной крутилкой — раскрытие
  // второй раз его уже не перезапросит.
  const pendingModels = useRef<Set<AbortController>>(new Set());

  const reloadProviders = useCallback(() => {
    pendingSnapshot.current?.abort();

    const controller = new AbortController();
    pendingSnapshot.current = controller;

    void Promise.all([
      fetchProvidersSnapshot(controller.signal),
      fetchUserProviders(controller.signal),
      fetchModelAliases(controller.signal),
    ])
      .then(([snapshot, userProviders, aliases]) =>
        apply((current) =>
          applyAliasesSnapshot(
            applyUserProvidersSnapshot(applySnapshot(current, snapshot), userProviders),
            aliases,
          ),
        ),
      )
      .catch((cause: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        const reason = reasonOf(cause);

        onDiagnostic(`the providers could not be read: ${reason}`);
        apply((current) => applyFailure(current, reason));
      });
  }, [apply, onDiagnostic]);

  const reloadAttempts = useCallback(() => {
    pendingAttempts.current?.abort();

    const controller = new AbortController();
    pendingAttempts.current = controller;

    void fetchLoginAttempts(controller.signal)
      .then((snapshot) => applyToLogins((current) => applyAttempts(current, snapshot)))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        // Диалог не восстановлен — это диагностика, а не отказ вью: список провайдеров от него не
        // зависит, и показывать вместо него пустой экран не за что.
        onDiagnostic(`the running logins could not be read: ${reasonOf(cause)}`);
      });
  }, [applyToLogins, onDiagnostic]);

  useEffect(() => {
    if (stream !== "open") {
      return;
    }

    reloadProviders();
    reloadAttempts();
  }, [stream, reloadProviders, reloadAttempts]);

  useEffect(() => {
    const unsubscribe = bus.subscribe((event) => {
      const outcome = applyStreamEvent(latest.current, event);

      apply(() => outcome.state);

      if (outcome.providers) {
        reloadProviders();
      }

      if (outcome.logins) {
        reloadAttempts();
      }
    });

    return unsubscribe;
  }, [apply, bus, reloadProviders, reloadAttempts]);

  useEffect(
    () => () => {
      pendingSnapshot.current?.abort();
      pendingAttempts.current?.abort();

      for (const controller of pendingModels.current) {
        controller.abort();
      }
    },
    [],
  );

  // Модели открытой страницы провайдера. Не жест раскрытия строки, а адрес: повторный заход на
  // страницу не перечитывает прочитанное, но отказавшее — переспрашивает (`shouldFetchModels`).
  useEffect(() => {
    if (providerId === undefined) {
      return;
    }

    if (!shouldFetchModels(latest.current, providerId)) {
      return;
    }

    apply((current) => markModelsLoading(current, providerId));

    const controller = new AbortController();
    pendingModels.current.add(controller);

    void fetchProviderModels(providerId, controller.signal)
      .then((answer) => apply((current) => applyModels(current, providerId, answer.models)))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        const reason = reasonOf(cause);

        onDiagnostic(`the models of ${providerId} could not be read: ${reason}`);
        apply((current) => applyModelsFailure(current, providerId, reason));
      })
      .finally(() => pendingModels.current.delete(controller));
  }, [apply, onDiagnostic, providerId]);

  const logIn = useCallback(
    (providerId: string, method: ProviderAuthType, target?: LoginKeyTarget) => {
      void startProviderLogin({ providerId, method, ...(target === undefined ? {} : { target }) })
        .then((outcome) => {
          applyToLogins((current) =>
            outcome.kind === "started"
              ? applyStarted(current, outcome.attempt)
              : applyTaken(current, outcome.conflict),
          );
        })
        .catch((cause: unknown) => {
          const reason = reasonOf(cause);

          onDiagnostic(`the login into ${providerId} could not be started: ${reason}`);
          applyToLogins((current) => applyStartFailure(current, reason));
        });
    },
    [applyToLogins, onDiagnostic],
  );

  const answer = useCallback(
    (providerId: string, stepId: string, value: string) => {
      const attemptId = latest.current.logins.dialogs[providerId]?.attempt.attemptId;

      if (attemptId === undefined) {
        return;
      }

      void answerLoginStep(attemptId, { stepId, value })
        .then((outcome) => {
          applyToLogins((current) =>
            outcome.kind === "answered"
              ? applyAnswered(current, providerId, stepId)
              : applyStaleAnswer(current, providerId, outcome.reason),
          );
        })
        .catch((cause: unknown) => {
          const reason = reasonOf(cause);

          onDiagnostic(`the login step could not be answered: ${reason}`);
          applyToLogins((current) => applyAnswerFailure(current, providerId, reason));
        });
    },
    [applyToLogins, onDiagnostic],
  );

  const cancelLogin = useCallback(
    (providerId: string) => {
      const attemptId = latest.current.logins.dialogs[providerId]?.attempt.attemptId;

      if (attemptId === undefined) {
        return;
      }

      // Исход не выдумывается: отмена приедет кадром `conclusion`, как и всякий другой конец.
      void cancelProviderLogin(attemptId).catch((cause: unknown) => {
        const reason = reasonOf(cause);

        onDiagnostic(`the login could not be cancelled: ${reason}`);
        applyToLogins((current) => applyAnswerFailure(current, providerId, reason));
      });
    },
    [applyToLogins, onDiagnostic],
  );

  const closeLogin = useCallback(
    (providerId: string) => applyToLogins((current) => closeLoginDialog(current, providerId)),
    [applyToLogins],
  );

  const logOut = useCallback(
    (providerId: string) => {
      // Список перезапросит событие `core.provider.logout`, а ответ маршрута нужен для другого: он
      // говорит, что провайдер остался настроенным кредом из окружения (docs/web-api.md).
      void logOutProvider(providerId)
        .then((summary) => applyToLogins((current) => applyLogout(current, summary)))
        .catch((cause: unknown) => {
          const reason = reasonOf(cause);

          onDiagnostic(`the logout from ${providerId} did not go through: ${reason}`);
          apply((current) => applyFailure(current, reason));
        });
    },
    [apply, applyToLogins, onDiagnostic],
  );

  /**
   * Правка ключа. Список перезапрашивается ответом маршрута, а не только событием: событие приедет
   * и так, но кнопка обязана погаснуть по факту записи, а не по факту его прихода.
   */
  const changeKey = useCallback(
    async (change: () => Promise<unknown>, what: string) => {
      try {
        await change();
        reloadProviders();
      } catch (cause: unknown) {
        const reason = reasonOf(cause);

        onDiagnostic(`${what} did not go through: ${reason}`);
        apply((current) => applyFailure(current, reason));
      }
    },
    [apply, onDiagnostic, reloadProviders],
  );

  const renameKey = useCallback(
    (providerId: string, keyId: string, label: string) =>
      changeKey(
        () => updateProviderKey(providerId, keyId, { label }),
        `renaming the key ${keyId} of ${providerId}`,
      ),
    [changeKey],
  );

  const selectKey = useCallback(
    (providerId: string, keyId: string) =>
      changeKey(
        () => updateProviderKey(providerId, keyId, { selected: true }),
        `selecting the key ${keyId} of ${providerId}`,
      ),
    [changeKey],
  );

  const removeKey = useCallback(
    (providerId: string, keyId: string) =>
      changeKey(
        () => removeProviderKey(providerId, keyId),
        `removing the key ${keyId} of ${providerId}`,
      ),
    [changeKey],
  );

  /**
   * Правка алиаса. Список провайдеров перезапрашивается следом: алиас — модель каталога, и её
   * появление или исчезновение меняет пикер моделей.
   */
  const saveAlias = useCallback(
    (alias: ModelAlias, existing: boolean) =>
      changeKey(() => saveModelAlias(alias, existing), `saving the alias ${alias.id}`),
    [changeKey],
  );

  const removeAlias = useCallback(
    (aliasId: string) =>
      changeKey(() => deleteModelAlias(aliasId), `removing the alias ${aliasId}`),
    [changeKey],
  );

  const receiveLoginStep = useCallback(
    (frame: LoginStepFrame) => {
      const outcome = applyLoginStep(latest.current.logins, frame);

      applyToLogins(() => outcome.state);

      if (outcome.refetch) {
        reloadAttempts();
      }
    },
    [applyToLogins, reloadAttempts],
  );

  return {
    state,
    logIn,
    answer,
    cancelLogin,
    closeLogin,
    logOut,
    renameKey,
    selectKey,
    removeKey,
    saveAlias,
    removeAlias,
    receiveLoginStep,
  };
}
