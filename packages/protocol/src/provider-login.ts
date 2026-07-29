/**
 * Интерактивный вход в LLM-провайдера (docs/models-and-providers.md).
 *
 * Вход — это диалог: показать ссылку, показать код устройства, спросить ключ, сообщить прогресс.
 * По шине это делать нельзя — событие там уведомление, запрос-ответ запрещён
 * ([docs/event-bus.md]). Поэтому шаги едут кадром существующего SSE-соединения
 * (`event-stream.ts`), а ответы приходят обычным `POST`.
 *
 * Типы шагов объявлены здесь, а не реэкспортированы из рантайма: это публичный контракт платформы,
 * и смена рантайма не должна ломать вью провайдеров.
 */

import type { ProviderAuthType } from "./provider.ts";
import type { SettingsParseResult } from "./settings.ts";

export const providerLoginsPath = "/api/provider-logins";
export const providerLoginPathPattern = `${providerLoginsPath}/:attemptId`;
export const providerLoginAnswerPathPattern = `${providerLoginsPath}/:attemptId/answer`;

export function providerLoginPath(attemptId: string): string {
  return `${providerLoginsPath}/${encodeURIComponent(attemptId)}`;
}

export function providerLoginAnswerPath(attemptId: string): string {
  return `${providerLoginsPath}/${encodeURIComponent(attemptId)}/answer`;
}

/** Вариант выбора в шаге `select`. Ответом уезжает `id`, а не подпись. */
export type LoginOption = {
  id: string;
  label: string;
  description?: string;
};

/**
 * Вопрос, на который платформа ждёт ответа. Видов четыре, ровно как у рантайма: своего вида мы не
 * добавляем — отвечать на него было бы нечему.
 *
 * `stepId` меняется на каждый вопрос: ответ на позавчерашний шаг обязан быть отличим от ответа на
 * нынешний, иначе повторная отправка формы отвечает не туда.
 */
export type LoginPrompt = { stepId: string; message: string } & (
  | { kind: "text"; placeholder?: string }
  /** Ответ — секрет: ключ API. В журнал он не попадает никогда. */
  | { kind: "secret"; placeholder?: string }
  | { kind: "select"; options: LoginOption[] }
  /** Код, который человек забирает у провайдера руками и приносит обратно. */
  | { kind: "manual-code"; placeholder?: string }
);

export type LoginLink = {
  url: string;
  label?: string;
};

/** Сообщение по ходу входа, на которое отвечать не надо. Видов тоже четыре. */
export type LoginNotice =
  | { kind: "info"; message: string; links?: LoginLink[] }
  /** Ссылка, по которой человек входит у провайдера. */
  | { kind: "auth-url"; url: string; instructions?: string }
  /** Код устройства: человек вводит его на странице провайдера. */
  | {
      kind: "device-code";
      userCode: string;
      verificationUri: string;
      intervalSeconds?: number;
      expiresInSeconds?: number;
    }
  | { kind: "progress"; message: string };

/** Чем кончилась попытка. Причина отказа приходит от провайдера и показывается как есть. */
export type LoginConclusion =
  { kind: "succeeded" } | { kind: "cancelled" } | { kind: "failed"; reason: string };

/** Что уезжает кадром потока: либо вопрос, либо сообщение, либо конец. */
export type LoginStep =
  | { kind: "prompt"; prompt: LoginPrompt }
  | { kind: "notice"; notice: LoginNotice }
  | { kind: "conclusion"; conclusion: LoginConclusion };

/** Кто начал вход. Шаги попытки плагина едут в его воркер и никуда больше. */
export type LoginOrigin = "session" | "plugin";

/**
 * Идущая попытка входа, как её видит браузер. Нужна на переподключении: кадр мог уехать в разрыв,
 * и диалог восстанавливается из снимка, а не из окна догона.
 */
export type LoginAttemptState = {
  attemptId: string;
  providerId: string;
  method: ProviderAuthType;
  origin: LoginOrigin;
  /**
   * Может ли на шаг ответить эта вкладка. У попытки плагина — нет: отвечает плагин, а человек
   * должен видеть, что вход идёт, иначе провайдер выглядит занятым без причины.
   */
  answerable: boolean;
  /** Всё сказанное по ходу входа, в порядке появления. */
  notices: LoginNotice[];
  /** Вопрос, который ждёт ответа прямо сейчас. */
  pending?: LoginPrompt;
  startedAt: string;
};

export type LoginAttemptsSnapshot = {
  attempts: LoginAttemptState[];
};

/** Тело начала входа. `method` — то, что провайдер объявил в `logins`. */
export type LoginStart = {
  providerId: string;
  method: ProviderAuthType;
};

/** Тело ответа на шаг. `stepId` обязателен: без него ответ уехал бы не на тот вопрос. */
export type LoginAnswer = {
  stepId: string;
  value: string;
};

/**
 * Отказ начать второй вход в того же провайдера. Кроме текста отдаётся сама идущая попытка —
 * иначе вью не покажет человеку, что именно занимает провайдера (прецедент — `ProjectFolderTaken`).
 */
export type LoginAttemptTaken = {
  error: string;
  conflict: LoginAttemptState;
};

const startKeys = ["providerId", "method"];
const answerKeys = ["stepId", "value"];

export function parseLoginStart(raw: unknown, label = "login"): SettingsParseResult<LoginStart> {
  const fields = asObject(raw);

  if (fields === undefined) {
    return { kind: "rejected", diagnostics: [`${label} must be an object`] };
  }

  const diagnostics = diagnoseUnknownKeys(label, fields, startKeys);
  const providerId = trimmedText(fields["providerId"]);

  if (providerId === undefined) {
    diagnostics.push(`${label}.providerId must be a non-empty provider identifier`);

    return { kind: "rejected", diagnostics };
  }

  const method = fields["method"];

  if (method !== "api_key" && method !== "oauth") {
    diagnostics.push(`${label}.method must be "api_key" or "oauth", got ${JSON.stringify(method)}`);

    return { kind: "rejected", diagnostics };
  }

  return { kind: "parsed", value: { providerId, method }, diagnostics };
}

export function parseLoginAnswer(raw: unknown, label = "answer"): SettingsParseResult<LoginAnswer> {
  const fields = asObject(raw);

  if (fields === undefined) {
    return { kind: "rejected", diagnostics: [`${label} must be an object`] };
  }

  const diagnostics = diagnoseUnknownKeys(label, fields, answerKeys);
  const stepId = trimmedText(fields["stepId"]);

  if (stepId === undefined) {
    diagnostics.push(`${label}.stepId must name the step being answered`);

    return { kind: "rejected", diagnostics };
  }

  const value = fields["value"];

  // Значение не обрезается по краям и пустым быть вправе: это может быть ключ, а решать за
  // человека, что в его ключе лишнее, платформе нечем.
  if (typeof value !== "string") {
    diagnostics.push(`${label}.value must be a string`);

    return { kind: "rejected", diagnostics };
  }

  return { kind: "parsed", value: { stepId, value }, diagnostics };
}

function trimmedText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed === "" ? undefined : trimmed;
}

function asObject(raw: unknown): Record<string, unknown> | undefined {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : undefined;
}

function diagnoseUnknownKeys(
  label: string,
  fields: Record<string, unknown>,
  known: string[],
): string[] {
  return Object.keys(fields)
    .filter((key) => !known.includes(key))
    .map((key) => `${label}: unknown key ${JSON.stringify(key)} is ignored`);
}
