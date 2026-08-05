import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hookCriticalities,
  isHookCriticality,
  isPlatformHookName,
  platformHookMergeKinds,
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
    assert.equal(platformHookMergeKinds.tools_collect, "collecting");
    assert.equal(platformHookMergeKinds.before_session_start, "deciding");
    assert.equal(platformHookMergeKinds.permission_request, "deciding");
    assert.equal(platformHookMergeKinds.turn_finished, "observing");
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
