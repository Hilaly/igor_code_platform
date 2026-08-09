import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderAgentData } from "./agent-data.ts";

describe("the model-visible agent data", () => {
  it("omits the wrapper without an agent directory", () => {
    assert.equal(renderAgentData(), "");
  });

  it("escapes all XML metacharacters in the agent directory", () => {
    assert.equal(
      renderAgentData(`/tmp/agent&<>"'`),
      `<agent_data>\n  <directory>/tmp/agent&amp;&lt;&gt;&quot;&apos;</directory>\n</agent_data>`,
    );
  });
});
