import { minimumPasswordLength } from "@sovereign/protocol";
import { describe, expect, it } from "vitest";

import { checkCredentials } from "./credentials.ts";

const long = "x".repeat(minimumPasswordLength);

describe("checkCredentials", () => {
  it("says nothing about an empty field until there is something to say", () => {
    // Пустое поле — это «ещё не ввели», а не ошибка: показывать её человеку до первого символа
    // значит ругаться на него за то, что он только открыл страницу.
    expect(checkCredentials("", undefined)).toEqual({ kind: "incomplete" });
    expect(checkCredentials("", "")).toEqual({ kind: "incomplete" });
  });

  it("lets any non-empty password go to the login route", () => {
    // Длину при входе проверяет сервер и только он: правило могло измениться после того, как пароль
    // был задан, и запирать человека своей же новой проверкой нельзя.
    expect(checkCredentials("к", undefined)).toEqual({ kind: "ready" });
    expect(checkCredentials(long, undefined)).toEqual({ kind: "ready" });
  });

  it("names the minimum length while registering", () => {
    expect(checkCredentials("x".repeat(minimumPasswordLength - 1), "")).toEqual({
      kind: "problem",
      problem: "too-short",
    });
  });

  it("asks for the repeat before it complains about a mismatch", () => {
    // Порядок важен: иначе «пароли не совпадают» загорается на первом же символе первого поля.
    expect(checkCredentials(long, "")).toEqual({ kind: "incomplete" });
  });

  it("catches a typo in the repeated password", () => {
    expect(checkCredentials(long, `${long}!`)).toEqual({ kind: "problem", problem: "mismatch" });
  });

  it("lets a matching pair through", () => {
    expect(checkCredentials(long, long)).toEqual({ kind: "ready" });
  });

  it("compares the repeat before the length, not after", () => {
    // Оба поля коротки и совпадают: сказать надо про длину, потому что именно её человек не может
    // исправить повтором.
    expect(checkCredentials("кратко", "кратко")).toEqual({
      kind: "problem",
      problem: "too-short",
    });
  });
});
