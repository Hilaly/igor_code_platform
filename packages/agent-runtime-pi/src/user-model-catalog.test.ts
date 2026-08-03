import assert from "node:assert/strict";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { describe, it } from "node:test";

import type { CustomProviderApi, UserProviderDefinition } from "@sovereign/protocol";

import { fetchUserModelIds, mergeDiscoveredModels } from "./user-model-catalog.ts";

function definition(api: CustomProviderApi): UserProviderDefinition {
  return {
    id: "vendor",
    name: "Vendor",
    baseUrl: "https://vendor.test/v1",
    api,
    modelsEndpoint: { kind: "custom", url: "http://127.0.0.1/models" },
    modelDefaults: {
      contextWindow: 128_000,
      maxTokens: 8_192,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0 },
    },
    manualModels: [{ id: "manual", name: "Manual wins", contextWindow: 32_000, maxTokens: 4_096 }],
    modelOverrides: { alpha: { name: "Alpha", reasoning: true } },
    disabledModelIds: ["hidden"],
  };
}

describe("user model catalog merging", () => {
  it("applies defaults and overrides while manual and disabled models win", () => {
    const models = mergeDiscoveredModels(definition("openai-responses"), [
      "alpha",
      "manual",
      "hidden",
      "alpha",
    ]);

    assert.deepEqual(
      models.map((model) => [model.id, model.name, model.reasoning]),
      [["alpha", "Alpha", true]],
    );
    assert.equal(models[0]?.contextWindow, 128_000);
    assert.equal(models[0]?.api, "openai-responses");
  });
});

describe("remote user model catalogs", () => {
  for (const scenario of [
    {
      api: "openai-responses" as const,
      body: { data: [{ id: "alpha" }], has_more: false },
      header: "authorization",
      value: "Bearer s3cret",
    },
    {
      api: "anthropic-messages" as const,
      body: { data: [{ id: "claude" }], has_more: false },
      header: "x-api-key",
      value: "s3cret",
    },
    {
      api: "google-generative-ai" as const,
      body: { models: [{ name: "models/gemini" }] },
      header: "x-goog-api-key",
      value: "s3cret",
    },
  ]) {
    it(`reads ${scenario.api} envelopes with protocol auth`, async () => {
      const requests: { url?: string; headers: IncomingHttpHeaders }[] = [];
      const server = createServer((request, response) => {
        requests.push({ url: request.url, headers: request.headers });
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(scenario.body));
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

      try {
        const address = server.address();
        assert.ok(address && typeof address === "object");
        const found = await fetchUserModelIds(
          {
            ...definition(scenario.api),
            modelsEndpoint: { kind: "custom", url: `http://127.0.0.1:${address.port}/models` },
          },
          "s3cret",
        );

        assert.deepEqual(found, [
          scenario.api === "google-generative-ai" ? "gemini" : scenario.body.data?.[0]?.id,
        ]);
        assert.equal(requests[0]?.headers[scenario.header], scenario.value);
        if (scenario.api === "anthropic-messages") {
          assert.equal(requests[0]?.headers["anthropic-version"], "2023-06-01");
        }
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    });
  }

  it("follows pagination and rejects malformed envelopes without leaking bodies", async () => {
    let page = 0;
    const server = createServer((_request, response) => {
      page += 1;
      response.setHeader("content-type", "application/json");
      response.end(
        page === 1
          ? JSON.stringify({ data: [{ id: "one" }], has_more: true, last_id: "one" })
          : JSON.stringify({ data: [{ id: "two" }], has_more: false }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      const found = await fetchUserModelIds(
        {
          ...definition("openai-completions"),
          modelsEndpoint: { kind: "custom", url: `http://127.0.0.1:${address.port}/models` },
        },
        "key",
      );
      assert.deepEqual(found, ["one", "two"]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("does not follow redirects with a provider credential", async () => {
    let leaked: string | undefined;
    const receiver = createServer((request, response) => {
      const header = request.headers["x-api-key"];
      leaked = Array.isArray(header) ? header[0] : header;
      response.end('{"data":[]}');
    });
    await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
    const redirector = createServer((_request, response) => {
      const address = receiver.address();
      assert.ok(address && typeof address === "object");
      response.writeHead(302, { location: `http://127.0.0.1:${address.port}/stolen` });
      response.end();
    });
    await new Promise<void>((resolve) => redirector.listen(0, "127.0.0.1", resolve));

    try {
      const address = redirector.address();
      assert.ok(address && typeof address === "object");
      await assert.rejects(() =>
        fetchUserModelIds(
          {
            ...definition("anthropic-messages"),
            modelsEndpoint: { kind: "custom", url: `http://127.0.0.1:${address.port}/models` },
          },
          "must-not-leak",
        ),
      );
      assert.equal(leaked, undefined);
    } finally {
      await new Promise<void>((resolve) => redirector.close(() => resolve()));
      await new Promise<void>((resolve) => receiver.close(() => resolve()));
    }
  });

  it("keeps valid models when a catalog page contains malformed entries", async () => {
    const server = createServer((_request, response) => {
      response.end(JSON.stringify({ data: [{ id: "valid" }, {}, { id: "" }] }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      const found = await fetchUserModelIds(
        {
          ...definition("openai-responses"),
          modelsEndpoint: { kind: "custom", url: `http://127.0.0.1:${address.port}/models` },
        },
        "key",
      );
      assert.deepEqual(found, ["valid"]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
