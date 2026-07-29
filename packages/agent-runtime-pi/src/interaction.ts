/**
 * Перевод диалога входа: вопросы и сообщения рантайма — в типы протокола и обратно
 * (docs/models-and-providers.md).
 *
 * Своих видов шага мы не добавляем и чужих не теряем: их четыре и четыре, и перевод обязан быть
 * полным — пропущенный вид означал бы вход, зависший на вопросе, которого никто не увидел.
 */

import type { AuthEvent, AuthInteraction, AuthPrompt } from "@earendil-works/pi-ai";
import type { LoginNotice, LoginPrompt } from "@sovereign/protocol";

export type LoginDialogue = {
  /** Задать вопрос и дождаться ответа. Отклонение обещания прекращает вход. */
  ask: (prompt: LoginPrompt) => Promise<string>;
  /** Сказать то, на что отвечать не надо. */
  tell: (notice: LoginNotice) => void;
  /** Откуда берутся идентификаторы шагов: ответ обязан называть вопрос, на который он отвечает. */
  nextStepId: () => string;
};

export function toRuntimeInteraction(
  dialogue: LoginDialogue,
  signal?: AbortSignal,
): AuthInteraction {
  return {
    ...(signal === undefined ? {} : { signal }),
    prompt: (prompt) => ask(dialogue, prompt),
    notify: (event) => dialogue.tell(describeNotice(event)),
  };
}

/**
 * У каждого вопроса рантайма может быть свой `signal`. Он гасит **этот вопрос**, а не вход: так
 * закрывается ручной ввод кода, проигравший гонку колбэк-серверу. Значит ждущего надо отклонить, а
 * попытку оставить жить — иначе успешный вход по колбэку падал бы вместе с отменённым вопросом.
 */
function ask(dialogue: LoginDialogue, prompt: AuthPrompt): Promise<string> {
  const asked = dialogue.ask(describePrompt(dialogue.nextStepId(), prompt));
  const signal = prompt.signal;

  if (signal === undefined) {
    return asked;
  }

  if (signal.aborted) {
    return Promise.reject(new Error("the step was cancelled before it was asked"));
  }

  return new Promise<string>((resolve, reject) => {
    const giveUp = (): void => reject(new Error("the step was cancelled by the login flow"));

    signal.addEventListener("abort", giveUp, { once: true });
    asked.then(resolve, reject).finally(() => signal.removeEventListener("abort", giveUp));
  });
}

function describePrompt(stepId: string, prompt: AuthPrompt): LoginPrompt {
  const common = { stepId, message: prompt.message };

  switch (prompt.type) {
    case "text":
      return { ...common, kind: "text", ...optionalPlaceholder(prompt.placeholder) };
    case "secret":
      return { ...common, kind: "secret", ...optionalPlaceholder(prompt.placeholder) };
    case "manual_code":
      return { ...common, kind: "manual-code", ...optionalPlaceholder(prompt.placeholder) };
    case "select":
      return {
        ...common,
        kind: "select",
        options: prompt.options.map((option) => ({
          id: option.id,
          label: option.label,
          ...(option.description === undefined ? {} : { description: option.description }),
        })),
      };
  }
}

function describeNotice(event: AuthEvent): LoginNotice {
  switch (event.type) {
    case "info":
      return {
        kind: "info",
        message: event.message,
        ...(event.links === undefined
          ? {}
          : {
              links: event.links.map((link) => ({
                url: link.url,
                ...(link.label === undefined ? {} : { label: link.label }),
              })),
            }),
      };
    case "auth_url":
      return {
        kind: "auth-url",
        url: event.url,
        ...(event.instructions === undefined ? {} : { instructions: event.instructions }),
      };
    case "device_code":
      return {
        kind: "device-code",
        userCode: event.userCode,
        verificationUri: event.verificationUri,
        ...(event.intervalSeconds === undefined ? {} : { intervalSeconds: event.intervalSeconds }),
        ...(event.expiresInSeconds === undefined
          ? {}
          : { expiresInSeconds: event.expiresInSeconds }),
      };
    case "progress":
      return { kind: "progress", message: event.message };
  }
}

function optionalPlaceholder(placeholder: string | undefined): { placeholder?: string } {
  return placeholder === undefined ? {} : { placeholder };
}
