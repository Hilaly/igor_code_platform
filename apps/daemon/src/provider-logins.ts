/**
 * Реестр идущих попыток входа в провайдеров (docs/models-and-providers.md).
 *
 * Один вызов входа живёт внутри одной записи реестра: диалог рантайма — это вопросы, которые кто-то
 * должен увидеть и на которые кто-то должен ответить, а вопрос без адресата висит вечно. Реестр и
 * есть тот, кто сводит вопрос с отвечающим.
 *
 * **Реестр в памяти, и это намеренно.** Попытка входа — это живой диалог с провайдером, и пережить
 * перезапуск демона она не может: на той стороне уже никого нет.
 */

import { randomBytes } from "node:crypto";

import type {
  LoginAttemptState,
  LoginNotice,
  LoginOrigin,
  LoginPrompt,
  LoginStep,
} from "@sovereign/protocol";

import type { Logger } from "./platform/public.ts";

/** Что реестру нужно от каталога провайдеров. Больше он о рантайме не знает ничего. */
export type LoginRunner = {
  login: (input: {
    providerId: string;
    method: "api_key" | "oauth";
    dialogue: {
      ask: (prompt: LoginPrompt) => Promise<string>;
      tell: (notice: LoginNotice) => void;
      nextStepId: () => string;
    };
    signal?: AbortSignal;
  }) => Promise<void>;
};

export type StartLoginInput = {
  providerId: string;
  method: "api_key" | "oauth";
  origin: LoginOrigin;
  /** Кому принадлежит попытка: идентификатор сессии входа или ключ плагина. */
  owner: string;
};

export type StartLoginOutcome =
  | { kind: "started"; attempt: LoginAttemptState }
  /** В этого провайдера уже входят. Отдаётся идущая попытка: отказ обязан назвать занявшего. */
  | { kind: "taken"; conflict: LoginAttemptState };

export type AnswerOutcome =
  | { kind: "answered" }
  | { kind: "unknown" }
  /** Шаг больше не ждёт ответа: человек отправил форму дважды либо ответил на прошлый вопрос. */
  | { kind: "stale" }
  /** Отвечать этой попытке не эта сторона: её начал плагин. */
  | { kind: "notYours" };

export type ProviderLogins = {
  start: (input: StartLoginInput) => StartLoginOutcome;
  answer: (attemptId: string, stepId: string, value: string, owner: string) => AnswerOutcome;
  /** Отменить попытку. `false` — такой попытки нет. */
  cancel: (attemptId: string, owner?: string) => boolean;
  /** Отменить всё, что принадлежит владельцу: выход из платформы, выгрузка плагина. */
  cancelOwnedBy: (owner: string) => void;
  /** Идёт ли вход в этого провайдера прямо сейчас. */
  runningFor: (providerId: string) => LoginAttemptState | undefined;
  list: () => LoginAttemptState[];
  /**
   * Шаг попытки. Кадр в поток отдаёт тот, кто это слушает, — реестр про SSE не знает. Состояние
   * попытки передаётся целиком: на завершающем шаге её в реестре уже нет, а получателю всё равно
   * надо знать провайдера и то, чья это попытка.
   */
  subscribe: (listener: (attempt: LoginAttemptState, step: LoginStep) => void) => () => void;
};

export type CreateProviderLoginsOptions = {
  runner: LoginRunner;
  logger: Logger;
  /**
   * Сколько шаг ждёт ответа. Брошенная вкладка иначе держала бы провайдера занятым до перезапуска
   * демона, и войти было бы нельзя вовсе.
   */
  stepTimeoutMs?: number;
  /** Потолок на попытку целиком: диалог, который вечно сообщает прогресс, тоже держит слот. */
  attemptTimeoutMs?: number;
  now?: () => number;
  /** Подменяется тестами, чтобы не ждать настоящих десяти минут. */
  schedule?: (run: () => void, delayMs: number) => () => void;
};

const defaultStepTimeoutMs = 10 * 60 * 1000;
const defaultAttemptTimeoutMs = 30 * 60 * 1000;
const attemptIdLengthBytes = 9;

type Attempt = {
  state: LoginAttemptState;
  owner: string;
  controller: AbortController;
  /** Кому отдать ответ на текущий вопрос. */
  waiting?: { stepId: string; resolve: (value: string) => void; reject: (cause: Error) => void };
  cancelStepTimer?: () => void;
  cancelAttemptTimer: () => void;
  steps: number;
  /**
   * Сколько провайдер сам готов ждать ввода кода устройства. Гасить вопрос раньше, чем провайдер
   * перестанет принимать код, значит обрывать вход, который ещё жив.
   */
  stepPatienceMs?: number;
};

export function createProviderLogins(options: CreateProviderLoginsOptions): ProviderLogins {
  const now = options.now ?? Date.now;
  const schedule =
    options.schedule ??
    ((run, delayMs) => {
      const timer = setTimeout(run, delayMs);

      // Таймер не держит процесс: демон обязан останавливаться, не дожидаясь чужого диалога.
      timer.unref();

      return () => clearTimeout(timer);
    });
  const stepTimeoutMs = options.stepTimeoutMs ?? defaultStepTimeoutMs;
  const attemptTimeoutMs = options.attemptTimeoutMs ?? defaultAttemptTimeoutMs;

  const attempts = new Map<string, Attempt>();
  const listeners = new Set<(attempt: LoginAttemptState, step: LoginStep) => void>();

  const announce = (state: LoginAttemptState, step: LoginStep): void => {
    for (const listener of listeners) {
      listener(state, step);
    }
  };

  const clearStepTimer = (attempt: Attempt): void => {
    attempt.cancelStepTimer?.();
    attempt.cancelStepTimer = undefined;
  };

  const finish = (attemptId: string, attempt: Attempt, step: LoginStep): void => {
    if (attempts.get(attemptId) !== attempt) {
      return;
    }

    clearStepTimer(attempt);
    attempt.cancelAttemptTimer();
    attempts.delete(attemptId);
    announce(attempt.state, step);
  };

  const giveUp = (attemptId: string, attempt: Attempt, reason: string): void => {
    clearStepTimer(attempt);
    attempt.waiting?.reject(new Error(reason));
    attempt.waiting = undefined;
    attempt.state.pending = undefined;
    attempt.controller.abort();
  };

  const timeout = (attemptId: string, attempt: Attempt): void => {
    giveUp(attemptId, attempt, "the login took too long");
    options.logger.info("a provider login ended without a credential", {
      providerId: attempt.state.providerId,
      attemptId,
      origin: attempt.state.origin,
      conclusion: "cancelled",
    });
    finish(attemptId, attempt, { kind: "conclusion", conclusion: { kind: "cancelled" } });
  };

  return {
    start: (input) => {
      const running = [...attempts.values()].find(
        (attempt) => attempt.state.providerId === input.providerId,
      );

      // Второй вход в того же провайдера отклоняется, а не отменяет первый: автоотмена убивала бы
      // наполовину пройденный диалог у того, кто его ведёт (docs/models-and-providers.md).
      if (running !== undefined) {
        return { kind: "taken", conflict: running.state };
      }

      const attemptId = randomBytes(attemptIdLengthBytes).toString("base64url");
      const controller = new AbortController();
      const state: LoginAttemptState = {
        attemptId,
        providerId: input.providerId,
        method: input.method,
        origin: input.origin,
        // Отвечает тот, кто начал. Попытка плагина видна человеку, но отвечает на её вопросы
        // плагин: иначе у одного вопроса стало бы два отвечающих.
        answerable: input.origin === "session",
        notices: [],
        startedAt: new Date(now()).toISOString(),
      };

      const attempt: Attempt = {
        state,
        owner: input.owner,
        controller,
        cancelAttemptTimer: schedule(() => {
          const live = attempts.get(attemptId);

          if (live !== undefined) {
            timeout(attemptId, live);
          }
        }, attemptTimeoutMs),
        steps: 0,
      };

      attempts.set(attemptId, attempt);

      const dialogue = {
        nextStepId: (): string => {
          attempt.steps += 1;

          return `${attemptId}-${String(attempt.steps)}`;
        },
        tell: (notice: LoginNotice): void => {
          // Сказанное копится в состоянии: переподключившаяся вкладка восстанавливает диалог
          // снимком, а не окном догона потока.
          state.notices.push(notice);

          if (notice.kind === "device-code" && notice.expiresInSeconds !== undefined) {
            attempt.stepPatienceMs = notice.expiresInSeconds * 1000;
          }

          announce(state, { kind: "notice", notice });
        },
        ask: (prompt: LoginPrompt): Promise<string> =>
          new Promise<string>((resolve, reject) => {
            state.pending = prompt;
            attempt.waiting = { stepId: prompt.stepId, resolve, reject };
            clearStepTimer(attempt);
            attempt.cancelStepTimer = schedule(
              () => {
                const live = attempts.get(attemptId);

                if (live !== undefined) {
                  giveUp(attemptId, live, "nobody answered the login step");
                }
              },
              Math.max(stepTimeoutMs, attempt.stepPatienceMs ?? 0),
            );
            announce(state, { kind: "prompt", prompt });
          }),
      };

      void options.runner
        .login({
          providerId: input.providerId,
          method: input.method,
          dialogue,
          signal: controller.signal,
        })
        .then(
          () => {
            if (attempts.get(attemptId) !== attempt) {
              return;
            }

            options.logger.info("a provider login succeeded", {
              providerId: input.providerId,
              attemptId,
              origin: input.origin,
            });
            finish(attemptId, attempt, { kind: "conclusion", conclusion: { kind: "succeeded" } });
          },
          (cause: unknown) => {
            if (attempts.get(attemptId) !== attempt) {
              return;
            }

            const reason = cause instanceof Error ? cause.message : String(cause);
            // Отмена и отказ провайдера — разные вещи для человека: первое сделал он сам, второе
            // надо читать. Различаются они по тому, гасили ли попытку.
            const conclusion = controller.signal.aborted
              ? ({ kind: "cancelled" } as const)
              : ({ kind: "failed", reason } as const);

            options.logger.info("a provider login ended without a credential", {
              providerId: input.providerId,
              attemptId,
              origin: input.origin,
              conclusion: conclusion.kind,
              ...(conclusion.kind === "failed" ? { reason } : {}),
            });
            finish(attemptId, attempt, { kind: "conclusion", conclusion });
          },
        );

      return { kind: "started", attempt: state };
    },
    answer: (attemptId, stepId, value, owner) => {
      const attempt = attempts.get(attemptId);

      if (attempt === undefined) {
        return { kind: "unknown" };
      }

      if (attempt.owner !== owner) {
        return { kind: "notYours" };
      }

      const waiting = attempt.waiting;

      // Устаревший `stepId` — не ошибка запроса, а повторная отправка формы или ответ на прошлый
      // вопрос. Ответить им на нынешний нельзя: вопросы разные.
      if (waiting === undefined || waiting.stepId !== stepId) {
        return { kind: "stale" };
      }

      clearStepTimer(attempt);
      attempt.waiting = undefined;
      attempt.state.pending = undefined;
      // Значение не пишется в журнал: на шаге `secret` это ключ (docs/models-and-providers.md).
      options.logger.debug("a provider login step was answered", {
        providerId: attempt.state.providerId,
        attemptId,
        step: stepId,
      });
      waiting.resolve(value);

      return { kind: "answered" };
    },
    cancel: (attemptId, owner) => {
      const attempt = attempts.get(attemptId);

      if (attempt === undefined || (owner !== undefined && attempt.owner !== owner)) {
        return false;
      }

      giveUp(attemptId, attempt, "the login was cancelled");

      return true;
    },
    cancelOwnedBy: (owner) => {
      for (const [attemptId, attempt] of attempts) {
        if (attempt.owner === owner) {
          giveUp(attemptId, attempt, "the login was cancelled");
        }
      }
    },
    runningFor: (providerId) =>
      [...attempts.values()].find((attempt) => attempt.state.providerId === providerId)?.state,
    list: () => [...attempts.values()].map((attempt) => attempt.state),
    subscribe: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
  };
}
