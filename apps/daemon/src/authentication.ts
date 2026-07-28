/**
 * Маршруты входа и проверка сессии для диспетчера (docs/authentication.md).
 *
 * Маршрутов входа четыре, и все, кроме выхода, открыты: спросить состояние входа и войти надо
 * уметь до всякой сессии. Открытость объявляется полем маршрута, а не выводится из пути, — иначе
 * забытая строка в таблице открыла бы API целиком (docs/web-api.md).
 */

import type { IncomingMessage } from "node:http";

import {
  accountPath,
  parsePasswordSubmission,
  sessionCookieName,
  sessionPath,
  type SessionStatus,
} from "@sovereign/protocol";
import { parseCookie, stringifySetCookie } from "cookie";

import type { AccountStore } from "./account.ts";
import {
  respondWithError,
  respondWithJson,
  type Authentication,
  type Route,
} from "./dispatcher.ts";
import type { LoginSessionStore, OpenedLoginSession } from "./login-sessions.ts";
import type { Logger } from "./logger.ts";

export type AuthenticationRoutesOptions = {
  account: AccountStore;
  sessions: LoginSessionStore;
  logger: Logger;
};

export type SessionCheckOptions = {
  sessions: Pick<LoginSessionStore, "verify">;
  account: Pick<AccountStore, "state">;
};

/**
 * Проверка сессии для диспетчера. Отдельно от маршрутов, потому что применяется ко всем маршрутам,
 * включая SSE-поток и будущие маршруты плагинов.
 *
 * Учётная запись спрашивается на каждом запросе, и это не лишний расход: `account.json` — короткий
 * файл в кеше файловой системы, а запросов у одного пользователя единицы в секунду. Спрашивать надо
 * именно каждый раз: сброс пароля — это удаление файла руками (docs/data-directory.md), и знать о нём
 * иначе неоткуда.
 */
export function createSessionCheck(
  options: SessionCheckOptions,
): (request: IncomingMessage) => Authentication {
  return (request) => {
    const token = readSessionToken(request);

    if (token === undefined) {
      return { kind: "none" };
    }

    // Сессия подтверждает учётную запись: нет записи — нет и того, что подтверждать. Иначе
    // украденная cookie переживала бы сброс пароля, ради которого файл и удаляли.
    if (options.account.state().kind !== "present") {
      return { kind: "none" };
    }

    const verified = options.sessions.verify(token);

    return verified.kind === "live" ? { kind: "session", id: verified.id } : { kind: "none" };
  };
}

export function authenticationRoutes(options: AuthenticationRoutesOptions): Route[] {
  const { account, sessions, logger } = options;

  return [
    {
      method: "GET",
      path: sessionPath,
      access: "open",
      handle: ({ response, session }) => {
        if (session !== undefined) {
          respondWithJson(response, 200, status("authenticated"));

          return;
        }

        const state = account.state();

        if (state.kind === "unreadable") {
          respondWithError(response, 409, state.reason);

          return;
        }

        respondWithJson(
          response,
          200,
          status(state.kind === "absent" ? "registration-required" : "unauthenticated"),
        );
      },
    },
    {
      method: "POST",
      path: accountPath,
      access: "open",
      handle: async ({ request, response, body }) => {
        const parsed = parsePasswordSubmission(body);

        if (parsed.kind === "rejected") {
          respondWithError(response, 400, parsed.reason);

          return;
        }

        const created = await account.create(parsed.value.password);

        if (created.kind === "unreadable") {
          respondWithError(response, 409, created.reason);

          return;
        }

        // Вторая учётная запись невозможна: пользователь один, и «первый вход» бывает один раз.
        if (created.kind === "conflict") {
          respondWithError(response, 409, "the account already exists, log in instead");

          return;
        }

        // Новая учётная запись обнуляет старые сессии. Учётная запись создаётся заново только после
        // сброса пароля, то есть после того, как файл удалили руками; сессии этого не видят и
        // переживали бы сброс, ради которого его и делали (docs/authentication.md).
        sessions.closeAll();

        // Сессия открывается сразу: вход отдельным запросом стоил бы ещё одного счёта хеша подряд,
        // а человек всё равно только что доказал, что знает пароль.
        logIn(response, sessions.open(), request, logger, "the owner registered and logged in");
      },
    },
    {
      method: "POST",
      path: sessionPath,
      access: "open",
      handle: async ({ request, response, body }) => {
        const parsed = parsePasswordSubmission(body);

        if (parsed.kind === "rejected") {
          respondWithError(response, 400, parsed.reason);

          return;
        }

        const verified = await account.verify(parsed.value.password);

        if (verified.kind === "unreadable") {
          respondWithError(response, 409, verified.reason);

          return;
        }

        if (verified.kind === "absent") {
          respondWithError(response, 409, "the account needs a registration first");

          return;
        }

        if (verified.kind === "rejected") {
          // Одна формулировка на неверный пароль и на торможение: различать их в ответе значило бы
          // рассказывать подбирающему, что он нащупал (docs/authentication.md).
          respondWithError(response, 401, "the password is not right");

          return;
        }

        logIn(response, sessions.open(), request, logger, "the owner logged in");
      },
    },
    {
      method: "DELETE",
      path: sessionPath,
      handle: ({ request, response }) => {
        const token = readSessionToken(request);

        // Токен здесь есть по построению: без живой сессии диспетчер до обработчика не пустил бы.
        if (token !== undefined) {
          sessions.close(token);
        }

        logger.info("the owner logged out");

        // Cookie гасится ответом, но защита не в этом: запись сессии удалена на сервере, поэтому
        // сохранённая копия cookie мертва вместе с ней.
        response.setHeader("set-cookie", clearedCookie());
        respondWithJson(response, 200, status("unauthenticated"));
      },
    },
  ];
}

function status(state: SessionStatus["state"]): SessionStatus {
  return { state };
}

function logIn(
  response: Parameters<typeof respondWithJson>[0],
  opened: OpenedLoginSession,
  request: IncomingMessage,
  logger: Logger,
  message: string,
): void {
  logger.info(message, { session: opened.id, client: request.socket.remoteAddress ?? "unknown" });

  response.setHeader("set-cookie", sessionCookie(opened));
  respondWithJson(response, 200, status("authenticated"));
}

/**
 * `HttpOnly` — токен не нужен браузерному коду вовсе, и не отдавать его скриптам дешевле, чем
 * защищаться от чтения. `SameSite=Strict` заменяет CSRF-токен: переход по чужой ссылке приходит
 * неаутентифицированным, и для локального интерфейса это норма.
 *
 * `Secure` не ставится: демон слушает `http` на петле, и с этим флагом браузер не отправил бы
 * cookie вообще. Появится туннель с TLS — флаг станет обязательным и придёт из конфигурации, а не
 * из схемы запроса (docs/authentication.md, «Доступ снаружи»).
 */
function sessionCookie(opened: OpenedLoginSession): string {
  return stringifySetCookie({
    name: sessionCookieName,
    value: opened.token,
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    // Срок совпадает со сроком серверной записи: сессионная cookie без срока умирала бы с закрытием
    // браузера, а запись жила бы дальше.
    expires: new Date(opened.expiresAt),
  });
}

function clearedCookie(): string {
  return stringifySetCookie({
    name: sessionCookieName,
    value: "",
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}

function readSessionToken(request: IncomingMessage): string | undefined {
  const header = request.headers.cookie;

  if (header === undefined) {
    return undefined;
  }

  const value = parseCookie(header)[sessionCookieName];

  // Пустая cookie — это погашенная cookie, а не токен нулевой длины.
  return value === undefined || value === "" ? undefined : value;
}
