import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isLoginStepFrame,
  isPluginStreamEvent,
  loginStepFrameKind,
  type LoginStepFrame,
  type PluginStreamEvent,
  type StreamEvent,
} from "./event-stream.ts";
import {
  parseLoginAnswer,
  parseLoginStart,
  providerLoginAnswerPath,
  providerLoginAnswerPathPattern,
  providerLoginPath,
  providerLoginPathPattern,
  providerLoginsPath,
} from "./provider-login.ts";

describe("provider login paths", () => {
  it("follow the patterns the daemon route table declares", () => {
    assert.equal(providerLoginPathPattern, `${providerLoginsPath}/:attemptId`);
    assert.equal(providerLoginAnswerPathPattern, `${providerLoginsPath}/:attemptId/answer`);
    assert.equal(providerLoginPath("a1b2"), "/api/provider-logins/a1b2");
    assert.equal(providerLoginAnswerPath("a1b2"), "/api/provider-logins/a1b2/answer");
  });
});

describe("parseLoginStart", () => {
  it("takes a provider and a way in", () => {
    const result = parseLoginStart({ providerId: "anthropic", method: "oauth" });

    assert.ok(result.kind === "parsed");
    assert.deepEqual(result.value, { providerId: "anthropic", method: "oauth" });
  });

  it("refuses a way in the platform has no steps for", () => {
    for (const method of [undefined, "magic", "", 1]) {
      const result = parseLoginStart({ providerId: "anthropic", method });

      assert.ok(result.kind === "rejected", `${JSON.stringify(method)} прошёл`);
    }
  });

  it("refuses a body that is not an object and an empty provider", () => {
    for (const raw of [undefined, null, "anthropic", ["anthropic"]]) {
      assert.equal(parseLoginStart(raw).kind, "rejected");
    }

    assert.equal(parseLoginStart({ providerId: "  ", method: "oauth" }).kind, "rejected");
  });
});

describe("parseLoginAnswer", () => {
  it("takes the step being answered and the value", () => {
    const result = parseLoginAnswer({ stepId: "s1", value: "sk-ant-..." });

    assert.ok(result.kind === "parsed");
    assert.deepEqual(result.value, { stepId: "s1", value: "sk-ant-..." });
  });

  it("keeps the value exactly as it came, spaces and all", () => {
    // Ключ — не имя проекта: решать за человека, что в нём лишнее, платформе нечем.
    const result = parseLoginAnswer({ stepId: "s1", value: "  key  " });

    assert.ok(result.kind === "parsed");
    assert.equal(result.value.value, "  key  ");
  });

  it("takes an empty value: a step may legitimately be answered with nothing", () => {
    const result = parseLoginAnswer({ stepId: "s1", value: "" });

    assert.ok(result.kind === "parsed");
  });

  it("refuses an answer that does not name its step", () => {
    assert.equal(parseLoginAnswer({ value: "key" }).kind, "rejected");
    assert.equal(parseLoginAnswer({ stepId: " ", value: "key" }).kind, "rejected");
  });

  it("refuses a value that is not a string", () => {
    assert.equal(parseLoginAnswer({ stepId: "s1", value: 42 }).kind, "rejected");
    assert.equal(parseLoginAnswer({ stepId: "s1" }).kind, "rejected");
  });
});

describe("the login step frame", () => {
  const loginFrame: LoginStepFrame = {
    index: 7,
    time: "2026-07-29T09:00:00.000Z",
    frame: loginStepFrameKind,
    attemptId: "a1b2",
    providerId: "anthropic",
    step: { kind: "notice", notice: { kind: "progress", message: "ждём провайдера" } },
  };

  const pluginFrame: PluginStreamEvent = {
    index: 8,
    time: "2026-07-29T09:00:01.000Z",
    type: "hello.said",
    payload: {},
    plugin: { key: "data:hello", id: "hello", source: "data" },
  };

  const coreFrame: StreamEvent = {
    index: 9,
    time: "2026-07-29T09:00:02.000Z",
    type: "core.providers.changed",
    payload: {},
  };

  it("is told apart from every other frame, and they from it", () => {
    assert.equal(isLoginStepFrame(loginFrame), true);
    assert.equal(isLoginStepFrame(pluginFrame), false);
    assert.equal(isLoginStepFrame(coreFrame), false);

    // Охранник шины кадр шага входа не принимает вовсе — это ловит компилятор, а не тест:
    // `isPluginStreamEvent` объявлен над `BusStreamEvent`. Здесь проверяется то, что компилятор
    // проверить не может: кадр приезжает из json, и по форме он не должен быть похож на кадр
    // плагина, иначе неаккуратное приведение типа отправило бы шаг входа подписчику шины.
    assert.equal("plugin" in loginFrame, false);
    assert.equal(isPluginStreamEvent(pluginFrame), true);
    assert.equal(isPluginStreamEvent(coreFrame), false);
  });

  it("narrows to the login frame so the step is readable without a cast", () => {
    const frame: StreamEvent = loginFrame;

    assert.ok(isLoginStepFrame(frame));
    assert.equal(frame.step.kind, "notice");
    assert.equal(frame.attemptId, "a1b2");
  });
});
