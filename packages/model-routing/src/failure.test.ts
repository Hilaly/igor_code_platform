import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyFailure, defaultCoolingMs } from "./failure.ts";

describe("classifyFailure", () => {
  it("blames the key for a rate limit and says how long to wait", () => {
    // Так пишет ошибку клиент Anthropic: код ответа впереди, тело следом.
    const verdict = classifyFailure({
      message: '429 {"type":"error","error":{"type":"rate_limit_error","message":"…"}}',
    });

    assert.deepEqual(verdict, {
      blame: "key",
      verdict: { kind: "cooling", forMs: defaultCoolingMs },
    });
  });

  it("waits exactly as long as the provider asked", () => {
    const verdict = classifyFailure({ status: 429, retryAfterMs: 5_000 });

    assert.deepEqual(verdict, { blame: "key", verdict: { kind: "cooling", forMs: 5_000 } });
  });

  it("refuses the key that was not accepted", () => {
    for (const status of [401, 402, 403]) {
      const verdict = classifyFailure({ message: `${String(status)} invalid x-api-key` });

      assert.equal(verdict.blame, "key", `${String(status)} не обвинил ключ`);
      assert.equal(
        verdict.blame === "key" ? verdict.verdict.kind : undefined,
        "refused",
        `${String(status)} не отказал ключу`,
      );
    }
  });

  it("blames the model for everything else that has a code", () => {
    for (const message of ["404 model not found", "400 bad request", "503 upstream is down"]) {
      assert.equal(classifyFailure({ message }).blame, "model", `${message} обвинил не модель`);
    }
  });

  it("reads the code out of a message that names it instead of leading with it", () => {
    assert.equal(classifyFailure({ message: "request failed, status: 429" }).blame, "key");
    assert.equal(classifyFailure({ message: "HTTP 500 from the gateway" }).blame, "model");
  });

  it("does not take a three-digit number out of the body for a code", () => {
    // В теле ошибки цифр сколько угодно: искать их по всей строке значит обвинить ключ по счёту
    // токенов.
    const verdict = classifyFailure({ message: "the request has 401 tokens too many" });

    assert.equal(verdict.blame, "none");
  });

  it("knows the well-known words when there is no code at all", () => {
    assert.deepEqual(classifyFailure({ message: "Rate limit reached for this key" }), {
      blame: "key",
      verdict: { kind: "cooling", forMs: defaultCoolingMs },
    });
    assert.equal(classifyFailure({ message: "authentication_error" }).blame, "key");
    assert.equal(classifyFailure({ message: "your credit balance is too low" }).blame, "key");
  });

  it("blames nobody for an abort", () => {
    // Отмену сделал человек: перебирать по ней ключи нечего.
    assert.equal(classifyFailure({ message: "The operation was aborted" }).blame, "none");
    assert.equal(classifyFailure({ message: "429 the request was cancelled" }).blame, "none");
  });

  it("blames nobody for a failure it does not recognise", () => {
    // Гадать по незнакомой строке — значит однажды сжечь весь набор ключей на своей же опечатке.
    for (const message of ["socket hang up", "", "the tool context is not set"]) {
      assert.equal(
        classifyFailure({ message }).blame,
        "none",
        `${JSON.stringify(message)} кого-то обвинил`,
      );
    }
  });

  it("always says something a human can read", () => {
    const verdict = classifyFailure({});

    assert.ok(verdict.blame === "none");
    assert.equal(verdict.reason, "the provider request failed");
  });
});
