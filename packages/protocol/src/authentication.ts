/**
 * Вход в интерфейс (docs/authentication.md). Пользователь один, ролей нет, поэтому «сессия» здесь —
 * это одна серверная запись о том, что человек вошёл, а не набор прав.
 *
 * Признак аутентификации едет в cookie, а не заголовком: браузерный `EventSource` не умеет ставить
 * заголовки, а SSE-поток — основное соединение интерфейса (docs/web-api.md).
 */

/**
 * Состояние входа. Читается без сессии: интерфейс обязан узнать его до всякого пароля.
 *
 * Имя `/api/sessions` занято сессиями агента (docs/sessions-and-projects.md), и соседство
 * `/api/session` с ним читалось бы как «одна из тех же сессий», хотя это другая сущность целиком.
 */
export const loginSessionPath = "/api/login-session";

/** Учётная запись. Создаётся один раз, первым входом. */
export const accountPath = "/api/account";

/**
 * Имя cookie. `HttpOnly`, `SameSite=Strict`, `Path=/`; флаг `Secure` не ставится — по `http`
 * браузер такую cookie не отправит вовсе (docs/authentication.md).
 */
export const sessionCookieName = "sovereign_session";

export const authenticationStates = [
  /** Учётной записи ещё нет: платформу открыли впервые. */
  "registration-required",
  /** Запись есть, живой сессии нет. */
  "unauthenticated",
  /** Живая сессия есть. */
  "authenticated",
] as const;

export type AuthenticationState = (typeof authenticationStates)[number];

/**
 * Ответ и `GET /api/login-session`, и успешного входа: у клиента одна форма на оба случая, и после входа
 * ему незачем перезапрашивать состояние, которое он только что изменил.
 */
export type SessionStatus = {
  state: AuthenticationState;
};

/** Тело входа и регистрации. Имени пользователя нет: пользователь один (docs/authentication.md). */
export type PasswordSubmission = {
  password: string;
};

/**
 * Нижняя граница длины пароля. Проверяется на сервере, а не только формой: маршрут открыт, и
 * единственная проверка, на которую можно опереться, — своя.
 *
 * Величину выбрал владелец продукта (docs/authentication.md): вход локальный и торможение подбора
 * своё, поэтому длина здесь защищает не от перебора по сети, а от пустого пароля.
 */
export const minimumPasswordLength = 6;

export type PasswordSubmissionParseResult =
  { kind: "parsed"; value: PasswordSubmission } | { kind: "rejected"; reason: string };

export function parsePasswordSubmission(raw: unknown): PasswordSubmissionParseResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { kind: "rejected", reason: "the request body must be an object with a password" };
  }

  const password = (raw as Record<string, unknown>)["password"];

  if (typeof password !== "string") {
    return { kind: "rejected", reason: "the password must be a string" };
  }

  // Пароль остаётся как введён, без обрезки пробелов: иначе пароль с пробелом на конце нельзя было
  // бы ввести повторно — регистрация и вход дали бы разные строки.
  if (password.length < minimumPasswordLength) {
    return {
      kind: "rejected",
      reason: `the password must be at least ${minimumPasswordLength} characters long`,
    };
  }

  return { kind: "parsed", value: { password } };
}
