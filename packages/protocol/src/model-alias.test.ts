import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  modelAliasPath,
  modelAliasPathPattern,
  modelAliasesPath,
  parseModelAliasDraft,
} from "./model-alias.ts";

const raw = {
  id: "opus-5",
  name: "Opus 5",
  candidates: [
    { providerId: "anthropic", modelId: "claude-opus-4-5" },
    { providerId: "openai", modelId: "gpt-5" },
  ],
};

describe("model alias paths", () => {
  it("address one alias as a single path segment", () => {
    assert.equal(modelAliasesPath, "/api/model-aliases");
    assert.equal(modelAliasPathPattern, "/api/model-aliases/:aliasId");
    assert.equal(modelAliasPath("opus-5"), "/api/model-aliases/opus-5");
    assert.equal(modelAliasPath("a/b"), "/api/model-aliases/a%2Fb");
  });
});

describe("parseModelAliasDraft", () => {
  it("keeps the order the human named", () => {
    const parsed = parseModelAliasDraft(raw);

    assert.ok(parsed.kind === "parsed");
    assert.deepEqual(parsed.value.candidates, [
      { providerId: "anthropic", modelId: "claude-opus-4-5" },
      { providerId: "openai", modelId: "gpt-5" },
    ]);
  });

  it("refuses an alias nobody can address", () => {
    for (const id of [undefined, "", "  ", "Opus 5", "ОПУС", "5/5"]) {
      assert.equal(
        parseModelAliasDraft({ ...raw, id }).kind,
        "rejected",
        `${JSON.stringify(id)} прошёл`,
      );
    }
  });

  it("refuses an alias with nothing behind it", () => {
    assert.equal(parseModelAliasDraft({ ...raw, candidates: [] }).kind, "rejected");
    assert.equal(parseModelAliasDraft({ ...raw, candidates: undefined }).kind, "rejected");
  });

  it("refuses an alias of an alias", () => {
    // Цикл разорвать нечем: обход кандидатов пошёл бы по кругу.
    const parsed = parseModelAliasDraft({
      ...raw,
      candidates: [{ providerId: "alias", modelId: "opus-5" }],
    });

    assert.ok(parsed.kind === "rejected");
    assert.ok(parsed.diagnostics.some((one) => one.includes("another alias")));
  });

  it("refuses the same model named twice", () => {
    assert.equal(
      parseModelAliasDraft({
        ...raw,
        candidates: [raw.candidates[0], raw.candidates[0]],
      }).kind,
      "rejected",
    );
  });

  it("names a key it does not know instead of swallowing it", () => {
    const parsed = parseModelAliasDraft({ ...raw, fallback: "anthropic/opus" });

    assert.ok(parsed.kind === "parsed");
    assert.ok(parsed.diagnostics.some((one) => one.includes("fallback")));
  });
});
