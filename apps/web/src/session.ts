/**
 * Запросы входа (docs/authentication.md). Токен интерфейс не видит вовсе: он лежит в `HttpOnly`
 * cookie, которую браузер ставит и отправляет сам, — поэтому здесь нет ни хранения, ни заголовков.
 *
 * Ни одна из этих функций не бросает. Вью входа — первое, что видит человек, и упасть здесь значит
 * показать пустую страницу вместо причины: и отказ демона, и его недоступность приезжают исходом.
 */

import {
  accountPath,
  sessionPath,
  type AuthenticationState,
  type SessionStatus,
} from "@sovereign/protocol";

export type SessionProbe =
  | { kind: "state"; state: AuthenticationState }
  /** Спросить не удалось: демон лежит или не может прочитать учётную запись. */
  | { kind: "unavailable"; reason: string };

export type SubmitOutcome =
  | { kind: "authenticated" }
  /**
   * Учётной записи нет. Отдельный исход, а не текст отказа: вью переключается на форму регистрации,
   * и делать это разбором сообщения значило бы читать текст, написанный для человека.
   */
  | { kind: "registration-required" }
  | { kind: "refused"; reason: string };

export async function probeSession(): Promise<SessionProbe> {
  try {
    const response = await fetch(sessionPath);

    if (!response.ok) {
      return { kind: "unavailable", reason: await reasonOf(response) };
    }

    return { kind: "state", state: ((await response.json()) as SessionStatus).state };
  } catch (cause) {
    return { kind: "unavailable", reason: messageOf(cause) };
  }
}

export function logIn(password: string): Promise<SubmitOutcome> {
  return submit(sessionPath, password);
}

export function register(password: string): Promise<SubmitOutcome> {
  return submit(accountPath, password);
}

/**
 * Выход. Отказ здесь не сообщается: сессии на сервере может уже не быть — истекла или её закрыла
 * соседняя вкладка, — и для человека это тот же выход.
 */
export async function logOut(): Promise<void> {
  try {
    await fetch(sessionPath, { method: "DELETE" });
  } catch {
    // Демон недоступен: cookie всё равно перестанет работать, а показывать отказ на выходе незачем.
  }
}

async function submit(path: string, password: string): Promise<SubmitOutcome> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (response.ok) {
      return { kind: "authenticated" };
    }

    const reason = await reasonOf(response);

    // `409` на маршруте входа означает ровно одно: учётной записи ещё нет. На маршруте регистрации
    // тот же код означает обратное — она уже есть, — и это отказ с причиной для человека.
    return response.status === 409 && path === sessionPath
      ? { kind: "registration-required" }
      : { kind: "refused", reason };
  } catch (cause) {
    return { kind: "refused", reason: messageOf(cause) };
  }
}

/** Форма отказа у демона одна на все маршруты: `{"error": "..."}` (docs/web-api.md). */
async function reasonOf(response: {
  status: number;
  json: () => Promise<unknown>;
}): Promise<string> {
  try {
    const failure = (await response.json()) as { error?: string };

    return failure.error ?? `the daemon answered ${response.status}`;
  } catch {
    return `the daemon answered ${response.status}`;
  }
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
