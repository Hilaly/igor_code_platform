import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import type { LoginAttemptState, LoginNotice, LoginPrompt, LoginStep } from "@sovereign/protocol";

import { createLogger, type Logger } from "./logger.ts";
import { createProviderLogins, type LoginRunner, type ProviderLogins } from "./provider-logins.ts";

const quietLogger = (): Logger =>
  createLogger({ source: "core", level: () => "debug", write: () => {} });

/**
 * Двойник рантайма: реестр знает о каталоге ровно один метод, и подменяется он целиком. Настоящий
 * перевод шагов Pi проверяется в `@sovereign/agent-runtime-pi` — там, где живут его типы.
 */
/** `Omit` по объединению теряет различитель, поэтому раздаётся по вариантам поимённо. */
type Unstepped<Prompt> = Prompt extends unknown ? Omit<Prompt, "stepId"> : never;

function runner() {
  type Session = {
    ask: (prompt: Unstepped<LoginPrompt>) => Promise<string>;
    tell: (notice: LoginNotice) => void;
    signal?: AbortSignal;
    settle: (outcome: { ok: true } | { failed: string }) => void;
  };

  const sessions: Session[] = [];
  const runner: LoginRunner = {
    login: (input) =>
      new Promise<void>((resolve, reject) => {
        sessions.push({
          ask: (prompt) => input.dialogue.ask({ ...prompt, stepId: input.dialogue.nextStepId() }),
          tell: input.dialogue.tell,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
          settle: (outcome) => ("ok" in outcome ? resolve() : reject(new Error(outcome.failed))),
        });
      }),
  };

  return {
    runner,
    /** Последняя начатая попытка глазами провайдера. */
    latest: (): Session => {
      const session = sessions.at(-1);

      assert.ok(session, "вход не начинался");

      return session;
    },
    count: () => sessions.length,
  };
}

let timers: { run: () => void; delayMs: number }[] = [];

beforeEach(() => {
  timers = [];
});

function logins(options: Partial<Parameters<typeof createProviderLogins>[0]> = {}) {
  const driver = runner();
  const registry: ProviderLogins = createProviderLogins({
    runner: driver.runner,
    logger: quietLogger(),
    // Таймеры собираются в список: ждать настоящих десяти минут тест не станет.
    schedule: (run, delayMs) => {
      const timer = { run, delayMs };

      timers.push(timer);

      return () => {
        timers = timers.filter((one) => one !== timer);
      };
    },
    ...options,
  });
  const steps: { attempt: LoginAttemptState; step: LoginStep }[] = [];

  registry.subscribe((attempt, step) => steps.push({ attempt, step }));

  return { registry, driver, steps };
}

const started = (outcome: ReturnType<ProviderLogins["start"]>) => {
  assert.ok(outcome.kind === "started", "вход не начался");

  return outcome.attempt;
};

const session = { providerId: "scripted", method: "api_key" as const, origin: "session" as const };

/** Ждёт, пока обещания диалога успеют разойтись: реестр отвечает через микрозадачи. */
const settled = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("starting a login", () => {
  it("registers the attempt and shows it in the list", () => {
    const { registry } = logins();
    const attempt = started(registry.start({ ...session, owner: "the-session" }));

    assert.equal(attempt.providerId, "scripted");
    assert.equal(attempt.origin, "session");
    assert.equal(attempt.answerable, true);
    assert.deepEqual(registry.list(), [attempt]);
    assert.deepEqual(registry.runningFor("scripted"), attempt);
    assert.equal(registry.runningFor("anthropic"), undefined);
  });

  it("refuses a second login into the same provider, naming the one running", () => {
    const { registry, driver } = logins();
    const first = started(registry.start({ ...session, owner: "the-session" }));
    const second = registry.start({ ...session, owner: "another-session" });

    // Автоотмена отвергнута: вторая вкладка убивала бы наполовину пройденный диалог первой.
    assert.ok(second.kind === "taken");
    assert.deepEqual(second.conflict, first);
    assert.equal(driver.count(), 1);
  });

  it("lets a login into another provider run at the same time", () => {
    const { registry } = logins();

    started(registry.start({ ...session, owner: "the-session" }));
    started(registry.start({ ...session, providerId: "anthropic", owner: "the-session" }));

    assert.equal(registry.list().length, 2);
  });

  it("marks an attempt a plugin started as one this side cannot answer", () => {
    const { registry } = logins();
    const attempt = started(
      registry.start({ ...session, origin: "plugin", owner: "data:assistant" }),
    );

    // Человек обязан видеть, что провайдер занят входом плагина, но отвечает на шаги плагин.
    assert.equal(attempt.answerable, false);
  });
});

describe("walking the dialogue", () => {
  it("carries a question out and an answer back", async () => {
    const { registry, driver, steps } = logins();
    const attempt = started(registry.start({ ...session, owner: "the-session" }));
    const asked = driver.latest().ask({ kind: "secret", message: "ключ" });

    await settled();

    const step = steps.at(-1)?.step;

    assert.ok(step?.kind === "prompt");
    assert.equal(step.prompt.kind, "secret");
    assert.deepEqual(registry.list()[0]?.pending, step.prompt);

    assert.deepEqual(
      registry.answer(attempt.attemptId, step.prompt.stepId, "sk-ключ", "the-session"),
      { kind: "answered" },
    );
    assert.equal(await asked, "sk-ключ");
    assert.equal(registry.list()[0]?.pending, undefined);
  });

  it("keeps what was said so a reconnected tab can rebuild the dialogue", async () => {
    const { registry, driver, steps } = logins();

    started(registry.start({ ...session, owner: "the-session" }));
    driver.latest().tell({ kind: "auth-url", url: "https://provider/login" });
    driver.latest().tell({ kind: "progress", message: "ждём" });
    await settled();

    assert.deepEqual(registry.list()[0]?.notices, [
      { kind: "auth-url", url: "https://provider/login" },
      { kind: "progress", message: "ждём" },
    ]);
    assert.deepEqual(
      steps.map(({ step }) => step.kind),
      ["notice", "notice"],
    );
  });

  it("refuses an answer to a step that is no longer waiting", async () => {
    const { registry, driver } = logins();
    const attempt = started(registry.start({ ...session, owner: "the-session" }));

    void driver.latest().ask({ kind: "text", message: "имя" });
    await settled();

    const stepId = registry.list()[0]?.pending?.stepId ?? "";

    assert.deepEqual(registry.answer(attempt.attemptId, stepId, "первый", "the-session"), {
      kind: "answered",
    });
    // Повторная отправка формы — не ошибка запроса и не ответ на нынешний вопрос.
    assert.deepEqual(registry.answer(attempt.attemptId, stepId, "второй", "the-session"), {
      kind: "stale",
    });
  });

  it("refuses an answer from someone the attempt does not belong to", async () => {
    const { registry, driver } = logins();
    const attempt = started(registry.start({ ...session, owner: "the-session" }));

    void driver.latest().ask({ kind: "text", message: "имя" });
    await settled();

    assert.deepEqual(
      registry.answer(
        attempt.attemptId,
        registry.list()[0]?.pending?.stepId ?? "",
        "чужой",
        "another-session",
      ),
      { kind: "notYours" },
    );
  });

  it("knows nothing about an attempt that ended", () => {
    const { registry } = logins();

    assert.deepEqual(registry.answer("выдуманный", "step", "value", "the-session"), {
      kind: "unknown",
    });
    assert.equal(registry.cancel("выдуманный"), false);
  });
});

describe("how an attempt ends", () => {
  it("says it succeeded and frees the provider", async () => {
    const { registry, driver, steps } = logins();

    started(registry.start({ ...session, owner: "the-session" }));
    driver.latest().settle({ ok: true });
    await settled();

    assert.deepEqual(steps.at(-1)?.step, {
      kind: "conclusion",
      conclusion: { kind: "succeeded" },
    });
    assert.deepEqual(registry.list(), []);
    assert.equal(registry.runningFor("scripted"), undefined);
  });

  it("carries a refusal of the provider out as it came", async () => {
    const { registry, driver, steps } = logins();

    started(registry.start({ ...session, owner: "the-session" }));
    driver.latest().settle({ failed: "провайдер отказал" });
    await settled();

    assert.deepEqual(steps.at(-1)?.step, {
      kind: "conclusion",
      conclusion: { kind: "failed", reason: "провайдер отказал" },
    });
  });

  it("tells a cancellation apart from a refusal", async () => {
    const { registry, driver, steps } = logins();
    const attempt = started(registry.start({ ...session, owner: "the-session" }));
    const asked = driver.latest().ask({ kind: "text", message: "имя" });

    await settled();
    assert.equal(registry.cancel(attempt.attemptId, "the-session"), true);
    await assert.rejects(asked, /cancelled/);

    driver.latest().settle({ failed: "the login was cancelled" });
    await settled();

    // Отмену сделал человек, и читать её причину ему незачем.
    assert.deepEqual(steps.at(-1)?.step, {
      kind: "conclusion",
      conclusion: { kind: "cancelled" },
    });
    assert.equal(driver.latest().signal?.aborted, true);
  });

  it("refuses to cancel an attempt of another owner", () => {
    const { registry } = logins();
    const attempt = started(registry.start({ ...session, owner: "the-session" }));

    assert.equal(registry.cancel(attempt.attemptId, "another-session"), false);
    assert.equal(registry.list().length, 1);
  });

  it("cancels everything one owner started and leaves the rest alone", async () => {
    const { registry, driver } = logins();

    started(registry.start({ ...session, owner: "the-session" }));
    started(registry.start({ ...session, providerId: "anthropic", owner: "data:assistant" }));

    // Выход из платформы: попытки сессии гаснут, попытки плагина живут.
    registry.cancelOwnedBy("the-session");
    await settled();

    assert.equal(registry.runningFor("anthropic")?.providerId, "anthropic");
    assert.equal(driver.latest().signal?.aborted, false);
  });

  it("gives up on a step nobody answers", async () => {
    const { registry, driver } = logins({ stepTimeoutMs: 1000 });

    started(registry.start({ ...session, owner: "the-session" }));

    const asked = driver.latest().ask({ kind: "text", message: "имя" });

    await settled();

    const stepTimer = timers.find((timer) => timer.delayMs === 1000);

    assert.ok(stepTimer, "таймер шага не заведён");
    stepTimer.run();

    // Брошенная вкладка иначе держала бы провайдера занятым до перезапуска демона.
    await assert.rejects(asked, /nobody answered/);
  });

  it("waits as long as the device code lives when that is longer", async () => {
    const { registry, driver } = logins({ stepTimeoutMs: 1000 });

    started(registry.start({ ...session, owner: "the-session" }));
    driver.latest().tell({
      kind: "device-code",
      userCode: "ABCD",
      verificationUri: "https://provider/device",
      expiresInSeconds: 900,
    });
    void driver.latest().ask({ kind: "manual-code", message: "код" });
    await settled();

    // Гасить вопрос раньше, чем провайдер перестанет принимать код, значит обрывать живой вход.
    assert.ok(timers.some((timer) => timer.delayMs === 900_000));
  });

  it("gives up on an attempt that never ends", async () => {
    const { registry, driver } = logins({ attemptTimeoutMs: 5000 });

    started(registry.start({ ...session, owner: "the-session" }));

    const attemptTimer = timers.find((timer) => timer.delayMs === 5000);

    assert.ok(attemptTimer, "потолок на попытку не заведён");
    attemptTimer.run();
    await settled();

    // Диалог, который вечно сообщает прогресс, тоже держит слот провайдера.
    assert.equal(driver.latest().signal?.aborted, true);
  });
});
