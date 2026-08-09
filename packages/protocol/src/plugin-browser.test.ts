import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hostModuleSpecifiers } from "./plugin-browser.ts";

describe("hostModuleSpecifiers", () => {
  it("makes the browser SDK a host module", () => {
    assert.equal(hostModuleSpecifiers.includes("@sovereign/browser-sdk"), true);
  });

  it("names every host module only once", () => {
    assert.equal(new Set(hostModuleSpecifiers).size, hostModuleSpecifiers.length);
  });
});
