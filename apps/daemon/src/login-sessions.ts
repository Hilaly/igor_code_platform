/**
 * Серверные сессии входа (docs/authentication.md). «Сессия» здесь — запись о том, что человек вошёл,
 * и с сессией агента (docs/sessions-and-projects.md) она не имеет ничего общего; отсюда и `login` в
 * имени файла и модуля.
 *
 * Токен непрозрачный, состояние на сервере. На диске лежит не токен, а его SHA-256: копия директории
 * данных не даёт живых сессий.
 */

import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomically } from "./atomic-file.ts";
import type { Logger } from "./logger.ts";

export const loginSessionsFileName = "login-sessions.json";

/** 32 байта из `randomBytes` в base64url (docs/authentication.md). */
const tokenLengthBytes = 32;

/** Идентификатор записи: он ходит внутри демона вместо токена, поэтому длины хватает короткой. */
const identifierLengthBytes = 12;

/**
 * Срок жизни сессии. Истечение обязано быть явным: сессии переживают перезапуск демона, потому что
 * лежат файлом, — а значит без срока токен жил бы вечно и истёкшие записи некому было бы вычищать
 * (docs/authentication.md).
 */
export const sessionLifetimeMilliseconds = 30 * 24 * 60 * 60 * 1_000;

export type OpenedLoginSession = {
  /**
   * Токен. Он существует только здесь и в cookie: на диск уходит его хеш, а внутрь демона —
   * идентификатор.
   */
  token: string;
  id: string;
  expiresAt: string;
};

export type VerifyTokenOutcome =
  | { kind: "live"; id: string }
  /** Токена нет, он истёк или сессию закрыли. Различать эти случаи снаружи незачем. */
  | { kind: "unknown" };

/** Кого закрыли. Идентификатор, а не токен: получателю незачем видеть чужой секрет. */
export type LoginSessionClosedListener = (id: string) => void;

export type LoginSessionStore = {
  open: () => OpenedLoginSession;
  verify: (token: string) => VerifyTokenOutcome;
  /** Закрыть сессию по токену. Токен чужой или неизвестный — ничего не происходит. */
  close: (token: string) => void;
  /**
   * Закрыть все сессии. Зовётся при создании учётной записи: иначе сброс пароля не сбрасывал бы
   * доступ, а только менял бы то, чем его получают заново (docs/authentication.md).
   */
  closeAll: () => void;
  /**
   * Узнать о закрытии — выходом или истечением. Нужен SSE-потоку: живой поток обязан обрываться
   * выходом, а не доживать до конца процесса (docs/authentication.md).
   *
   * Возвращает функцию отписки.
   */
  subscribe: (listener: LoginSessionClosedListener) => () => void;
};

export type CreateLoginSessionStoreOptions = {
  directory: string;
  logger: Logger;
  now?: () => number;
};

export function createLoginSessionStore(
  options: CreateLoginSessionStoreOptions,
): LoginSessionStore {
  const path = join(options.directory, loginSessionsFileName);
  const now = options.now ?? Date.now;
  const listeners = new Set<LoginSessionClosedListener>();

  // Набор читается один раз при старте и дальше живёт в памяти: файл пишет только этот модуль, а
  // проверка сессии идёт на каждом запросе, включая SSE-поток, — читать диск на каждый запрос
  // незачем.
  let sessions = readSessions(path, options.logger);

  const announce = (closed: StoredLoginSession[]): void => {
    for (const session of closed) {
      for (const listener of listeners) {
        listener(session.id);
      }
    }
  };

  /** Уборка истёкших. Записать успевает только тот вызов, который что-то выкинул. */
  const sweep = (): StoredLoginSession[] => {
    const moment = now();
    const live = sessions.filter((session) => Date.parse(session.expiresAt) > moment);

    if (live.length === sessions.length) {
      return [];
    }

    const expired = sessions.filter((session) => Date.parse(session.expiresAt) <= moment);

    sessions = live;

    return expired;
  };

  return {
    open: () => {
      const expired = sweep();
      const token = randomBytes(tokenLengthBytes).toString("base64url");
      const session: StoredLoginSession = {
        id: randomBytes(identifierLengthBytes).toString("base64url"),
        tokenHash: hashToken(token),
        createdAt: new Date(now()).toISOString(),
        expiresAt: new Date(now() + sessionLifetimeMilliseconds).toISOString(),
      };

      sessions = [...sessions, session];
      write(path, sessions);
      announce(expired);

      return { token, id: session.id, expiresAt: session.expiresAt };
    },
    verify: (token) => {
      const expired = sweep();

      if (expired.length > 0) {
        write(path, sessions);
        announce(expired);
      }

      const hash = hashToken(token);
      const found = sessions.find((session) => session.tokenHash === hash);

      return found === undefined ? { kind: "unknown" } : { kind: "live", id: found.id };
    },
    close: (token) => {
      const hash = hashToken(token);
      const closed = sessions.find((session) => session.tokenHash === hash);
      const expired = sweep();

      if (closed !== undefined) {
        sessions = sessions.filter((session) => session.tokenHash !== hash);
      }

      if (closed === undefined && expired.length === 0) {
        return;
      }

      write(path, sessions);
      announce(closed === undefined ? expired : [...expired, closed]);
    },
    closeAll: () => {
      const closed = sessions;

      if (closed.length === 0) {
        return;
      }

      sessions = [];
      write(path, sessions);

      // Истёкшие среди них тоже объявляются закрытыми: получателю всё равно, чем именно кончилась
      // сессия, а поток обязан оборваться в любом случае.
      announce(closed);
    },
    subscribe: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
  };
}

type StoredLoginSession = {
  id: string;
  /** SHA-256 токена в base64. Токена на диске нет вовсе (docs/authentication.md). */
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64");
}

/**
 * Негодный файл здесь не отказ, в отличие от настроек: под ним лежат сессии, а не решения человека.
 * Худшее, что стоит потеря файла, — новый вход, и требовать за это ручного вмешательства незачем
 * (docs/data-directory.md, «Ручное восстановление»).
 */
function readSessions(path: string, logger: Logger): StoredLoginSession[] {
  let raw: string;

  try {
    raw = readFileSync(path, "utf8");
  } catch (cause) {
    if (cause instanceof Error && (cause as { code?: unknown }).code === "ENOENT") {
      return [];
    }

    throw cause;
  }

  let document: unknown;

  try {
    document = JSON.parse(raw);
  } catch (cause) {
    logger.warn("the login sessions file is not valid json, every session was dropped", {
      file: loginSessionsFileName,
      reason: cause instanceof Error ? cause.message : String(cause),
    });

    return [];
  }

  const stored =
    typeof document === "object" && document !== null && !Array.isArray(document)
      ? (document as Record<string, unknown>)["sessions"]
      : undefined;

  if (!Array.isArray(stored)) {
    logger.warn(
      "the login sessions file does not hold a list of sessions, every session was dropped",
      {
        file: loginSessionsFileName,
      },
    );

    return [];
  }

  const sessions = stored.filter(isStoredSession);

  if (sessions.length !== stored.length) {
    logger.warn("some login session records were not readable and were dropped", {
      file: loginSessionsFileName,
      dropped: stored.length - sessions.length,
    });
  }

  return sessions;
}

function isStoredSession(raw: unknown): raw is StoredLoginSession {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return false;
  }

  const fields = raw as Record<string, unknown>;

  return (
    typeof fields["id"] === "string" &&
    typeof fields["tokenHash"] === "string" &&
    typeof fields["createdAt"] === "string" &&
    typeof fields["expiresAt"] === "string" &&
    !Number.isNaN(Date.parse(fields["expiresAt"]))
  );
}

function write(path: string, sessions: StoredLoginSession[]): void {
  writeFileAtomically(path, `${JSON.stringify({ sessions }, undefined, 2)}\n`);
}
