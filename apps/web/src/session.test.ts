import { accountPath, sessionPath } from "@sovereign/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { logIn, logOut, probeSession, register } from "./session.ts";

type Answer = { status: number; body: unknown };

/** Ответ демона подставляется целиком: проверяется разбор ответа и отказа, а не сеть. */
function daemon(...answers: Answer[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let next = 0;

  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init === undefined ? {} : { init }) });

    const answer = answers[Math.min(next, answers.length - 1)];
    next += 1;

    return Promise.resolve({
      ok: (answer?.status ?? 0) >= 200 && (answer?.status ?? 0) < 300,
      status: answer?.status ?? 0,
      json: () => Promise.resolve(answer?.body),
    });
  });

  return calls;
}

function unreachableDaemon(reason: string) {
  vi.stubGlobal("fetch", () => Promise.reject(new Error(reason)));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("probeSession", () => {
  it("gives back the state the daemon named", async () => {
    for (const state of ["registration-required", "unauthenticated", "authenticated"] as const) {
      const calls = daemon({ status: 200, body: { state } });

      await expect(probeSession()).resolves.toEqual({ kind: "state", state });
      expect(calls[0]?.url).toBe(sessionPath);
    }
  });

  it("carries the reason when the daemon cannot answer the question", async () => {
    // `409` здесь означает, что учётную запись на диске не прочитать: ни «войди», ни «зарегистрируйся»
    // не были бы правдой, и человеку надо показать причину.
    daemon({ status: 409, body: { error: "account.json is not valid json" } });

    await expect(probeSession()).resolves.toEqual({
      kind: "unavailable",
      reason: "account.json is not valid json",
    });
  });

  it("treats an unreachable daemon as an unavailable answer, not as a throw", async () => {
    // Вью входа — первое, что видит человек: упасть здесь значит показать пустую страницу вместо
    // причины.
    unreachableDaemon("failed to fetch");

    await expect(probeSession()).resolves.toEqual({
      kind: "unavailable",
      reason: "failed to fetch",
    });
  });
});

describe("logIn", () => {
  it("posts the password to the session route", async () => {
    const calls = daemon({ status: 200, body: { state: "authenticated" } });

    await expect(logIn("правильный пароль")).resolves.toEqual({ kind: "authenticated" });
    expect(calls[0]?.url).toBe(sessionPath);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ password: "правильный пароль" }));
  });

  it("carries the refusal as a reason instead of throwing", async () => {
    daemon({ status: 401, body: { error: "the password is not right" } });

    await expect(logIn("мимо")).resolves.toEqual({
      kind: "refused",
      reason: "the password is not right",
    });
  });

  it("says a registration is needed when the daemon has no account yet", async () => {
    // Отдельный исход, а не текст отказа: вью обязано переключиться на форму регистрации, а сделать
    // это по строке сообщения значило бы разбирать текст.
    daemon({ status: 409, body: { error: "the account needs a registration first" } });

    await expect(logIn("любой пароль")).resolves.toEqual({ kind: "registration-required" });
  });

  it("names the code when the refusal carries no reason", async () => {
    daemon({ status: 500, body: {} });

    await expect(logIn("любой пароль")).resolves.toEqual({
      kind: "refused",
      reason: "the daemon answered 500",
    });
  });

  it("carries an unreachable daemon as a reason too", async () => {
    unreachableDaemon("failed to fetch");

    await expect(logIn("любой пароль")).resolves.toEqual({
      kind: "refused",
      reason: "failed to fetch",
    });
  });
});

describe("register", () => {
  it("posts the password to the account route", async () => {
    const calls = daemon({ status: 200, body: { state: "authenticated" } });

    await expect(register("правильный пароль")).resolves.toEqual({ kind: "authenticated" });
    expect(calls[0]?.url).toBe(accountPath);
    expect(calls[0]?.init?.method).toBe("POST");
  });

  it("carries the reason of a refused registration", async () => {
    daemon({ status: 400, body: { error: "the password must be at least 8 characters long" } });

    await expect(register("кратко")).resolves.toEqual({
      kind: "refused",
      reason: "the password must be at least 8 characters long",
    });
  });
});

describe("logOut", () => {
  it("deletes the session", async () => {
    const calls = daemon({ status: 200, body: { state: "unauthenticated" } });

    await logOut();

    expect(calls[0]?.url).toBe(sessionPath);
    expect(calls[0]?.init?.method).toBe("DELETE");
  });

  it("does not throw when the daemon refuses the way out", async () => {
    // Сессии на сервере может уже не быть — истекла или её закрыла соседняя вкладка. Для человека
    // это тот же выход: показывать ему отказ незачем.
    daemon({ status: 401, body: { error: "the request needs a session" } });

    await expect(logOut()).resolves.toBeUndefined();
  });
});
