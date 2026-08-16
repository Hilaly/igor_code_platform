import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { installTestHost, type PluginTestHost } from "@sovereign/sdk/testing";

import { contributeRoutes } from "./routes.ts";
import { writeMission } from "./store.ts";

let host: PluginTestHost | undefined;

afterEach(() => {
  host?.restore();
  host = undefined;
});

const request = (sessionId: string) => ({
  method: "GET" as const,
  path: `snapshot/${sessionId}`,
  parameters: { sessionId },
  query: {},
  headers: {},
  public: false,
});

describe("mission snapshot route", () => {
  it("returns the stored snapshot and a JSON content type", async () => {
    host = installTestHost({ id: "mission" });
    await writeMission("s-1", { mission: "Ship", plan: [{ step: "Test", status: "pending" }] });
    await contributeRoutes();

    const response = await host.callRoute("snapshot", request("s-1"));

    assert.equal(response.status, 200);
    assert.equal(response.headers?.["content-type"], "application/json; charset=utf-8");
    assert.deepEqual(
      JSON.parse(String(response.body)),
      await import("./store.ts").then(({ readMission }) => readMission("s-1")),
    );
  });

  it("returns 404 when the session has no mission", async () => {
    host = installTestHost({ id: "mission" });
    await contributeRoutes();

    const response = await host.callRoute("snapshot", request("missing"));

    assert.equal(response.status, 404);
    assert.match(String(response.body), /there is no mission/u);
  });
});
