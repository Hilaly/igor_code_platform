import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hookCriticalities,
  isHookCriticality,
  isPlatformHookName,
  isSubscribablePlatformHook,
  platformHooks,
  platformHookNames,
} from "./hook.ts";

describe("platform hooks", () => {
  it("names six points of five hooks", () => {
    // Пять хуков платформы (docs/hooks.md), но у жизненного цикла сессии две точки вызова.
    assert.deepEqual(platformHookNames.toSorted(), [
      "before_session_start",
      "permission_request",
      "session_closed",
      "session_created",
      "tools_collect",
      "turn_finished",
    ]);
  });

  it("keeps the merge kind of every point", () => {
    assert.equal(platformHooks.tools_collect.merge, "collecting");
    assert.equal(platformHooks.before_session_start.merge, "deciding");
    assert.equal(platformHooks.permission_request.merge, "deciding");
    assert.equal(platformHooks.turn_finished.merge, "observing");
  });

  it("does not let a plugin subscribe to the collection of tools", () => {
    // Инструмент объявляется вкладом, а не подпиской: второй способ добавить инструмент нельзя было
    // бы выключить отдельно, хотя вклад выключается (docs/plugins.md).
    assert.equal(isPlatformHookName("tools_collect"), true);
    assert.equal(isSubscribablePlatformHook("tools_collect"), false);

    for (const name of platformHookNames.filter((candidate) => candidate !== "tools_collect")) {
      assert.equal(isSubscribablePlatformHook(name), true, name);
    }
  });

  it("does not recognise an event of the runtime as a platform hook", () => {
    // Имена Pi проверяются списком рантайма: протокол о них не знает и знать не должен.
    assert.equal(isPlatformHookName("tool_call"), false);
    assert.equal(isPlatformHookName("session_created"), true);
    assert.equal(isPlatformHookName(undefined), false);
  });
});

describe("hook criticality", () => {
  it("offers exactly two marks", () => {
    assert.deepEqual([...hookCriticalities], ["advisory", "critical"]);
  });

  it("refuses anything else", () => {
    for (const value of ["important", "", undefined, 1]) {
      assert.equal(isHookCriticality(value), false, String(value));
    }
  });
});
