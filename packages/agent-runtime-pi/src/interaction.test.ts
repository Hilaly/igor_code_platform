import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import type { LoginNotice, LoginPrompt } from "@sovereign/protocol";

import { toRuntimeInteraction, type LoginDialogue } from "./interaction.ts";

function dialogue(answer: (prompt: LoginPrompt) => Promise<string> = () => Promise.resolve("ok")) {
  const asked: LoginPrompt[] = [];
  const told: LoginNotice[] = [];
  let steps = 0;

  const spoken: LoginDialogue = {
    ask: (prompt) => {
      asked.push(prompt);

      return answer(prompt);
    },
    tell: (notice) => told.push(notice),
    nextStepId: () => {
      steps += 1;

      return `step-${String(steps)}`;
    },
  };

  return { spoken, asked, told };
}

describe("prompts of the runtime", () => {
  it("translates all four kinds and numbers every step", async () => {
    const { spoken, asked } = dialogue();
    const interaction = toRuntimeInteraction(spoken);

    const prompts: AuthPrompt[] = [
      { type: "text", message: "имя аккаунта", placeholder: "owner" },
      { type: "secret", message: "ключ" },
      {
        type: "select",
        message: "какой аккаунт",
        options: [
          { id: "one", label: "Первый", description: "рабочий" },
          { id: "two", label: "Второй" },
        ],
      },
      { type: "manual_code", message: "код со страницы" },
    ];

    for (const prompt of prompts) {
      await interaction.prompt(prompt);
    }

    assert.deepEqual(asked, [
      { stepId: "step-1", message: "имя аккаунта", kind: "text", placeholder: "owner" },
      { stepId: "step-2", message: "ключ", kind: "secret" },
      {
        stepId: "step-3",
        message: "какой аккаунт",
        kind: "select",
        options: [
          { id: "one", label: "Первый", description: "рабочий" },
          { id: "two", label: "Второй" },
        ],
      },
      { stepId: "step-4", message: "код со страницы", kind: "manual-code" },
    ]);
  });

  it("answers a selection with the option id, not its label", async () => {
    const { spoken } = dialogue((prompt) =>
      Promise.resolve(prompt.kind === "select" ? (prompt.options[1]?.id ?? "") : ""),
    );

    const answer = await toRuntimeInteraction(spoken).prompt({
      type: "select",
      message: "какой аккаунт",
      options: [
        { id: "one", label: "Первый" },
        { id: "two", label: "Второй" },
      ],
    });

    assert.equal(answer, "two");
  });

  it("lets a refusal of the dialogue stop the login", async () => {
    const { spoken } = dialogue(() => Promise.reject(new Error("человек передумал")));

    await assert.rejects(
      toRuntimeInteraction(spoken).prompt({ type: "text", message: "имя" }),
      /человек передумал/,
    );
  });
});

describe("a prompt the flow cancels itself", () => {
  it("rejects the waiter without touching the login", async () => {
    // Так закрывается ручной ввод кода, проигравший гонку колбэк-серверу: гасится вопрос, а не
    // вход. Отклони мы вход целиком — успешный вход по колбэку падал бы вместе с этим вопросом.
    const { spoken } = dialogue(() => new Promise<string>(() => undefined));
    const controller = new AbortController();
    const waiting = toRuntimeInteraction(spoken).prompt({
      type: "manual_code",
      message: "код со страницы",
      signal: controller.signal,
    });

    controller.abort();

    await assert.rejects(waiting, /cancelled/);
  });

  it("refuses a prompt whose signal was already aborted", async () => {
    const { spoken, asked } = dialogue();

    await assert.rejects(
      toRuntimeInteraction(spoken).prompt({
        type: "text",
        message: "поздно",
        signal: AbortSignal.abort(),
      }),
      /cancelled/,
    );
    // Спросить всё равно спросили: гонку выигрывает колбэк уже после того, как вопрос задан.
    assert.equal(asked.length, 1);
  });

  it("still answers when the signal never fires", async () => {
    const { spoken } = dialogue(() => Promise.resolve("код"));

    assert.equal(
      await toRuntimeInteraction(spoken).prompt({
        type: "manual_code",
        message: "код",
        signal: new AbortController().signal,
      }),
      "код",
    );
  });
});

describe("notices of the runtime", () => {
  it("translates all four kinds, `info` among them", () => {
    const { spoken, told } = dialogue();
    const interaction = toRuntimeInteraction(spoken);

    const events: AuthEvent[] = [
      { type: "info", message: "почти всё", links: [{ url: "https://x", label: "справка" }] },
      { type: "auth_url", url: "https://provider/login", instructions: "открой ссылку" },
      {
        type: "device_code",
        userCode: "ABCD-EFGH",
        verificationUri: "https://provider/device",
        intervalSeconds: 5,
        expiresInSeconds: 900,
      },
      { type: "progress", message: "ждём провайдера" },
    ];

    for (const event of events) {
      interaction.notify(event);
    }

    assert.deepEqual(told, [
      { kind: "info", message: "почти всё", links: [{ url: "https://x", label: "справка" }] },
      { kind: "auth-url", url: "https://provider/login", instructions: "открой ссылку" },
      {
        kind: "device-code",
        userCode: "ABCD-EFGH",
        verificationUri: "https://provider/device",
        intervalSeconds: 5,
        expiresInSeconds: 900,
      },
      { kind: "progress", message: "ждём провайдера" },
    ]);
  });

  it("leaves out what the runtime did not say", () => {
    const { spoken, told } = dialogue();

    toRuntimeInteraction(spoken).notify({ type: "auth_url", url: "https://provider/login" });

    assert.deepEqual(told, [{ kind: "auth-url", url: "https://provider/login" }]);
  });
});

describe("the whole-login signal", () => {
  it("is handed to the runtime as it came", () => {
    const controller = new AbortController();
    const { spoken } = dialogue();

    assert.equal(toRuntimeInteraction(spoken, controller.signal).signal, controller.signal);
    assert.equal(toRuntimeInteraction(spoken).signal, undefined);
  });
});
