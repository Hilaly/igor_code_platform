import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { installTestHost, type PluginTestHost } from "@sovereign/sdk/testing";

let host: PluginTestHost | undefined;

afterEach(() => {
  host?.restore();
  host = undefined;
});

describe("mission worker", () => {
  it("declares the changed event, tool, protected snapshot route, and both catalogs", async () => {
    host = installTestHost({ id: "mission", source: "builtin" });
    const { activate } = await import("./worker.ts");

    await activate();

    assert.deepEqual(
      host.contributions.map((contribution) => [contribution.kind, contribution.id]),
      [
        ["event", "changed"],
        ["tool", "mission-update"],
        ["route", "snapshot"],
        // Каталоги объявляет воркер, а строит из них переводчик браузерная половина: строки живут
        // одним модулем на обе, иначе расхождение поймал бы только читающий панель человек.
        ["locale-catalog", "messages-en"],
        ["locale-catalog", "messages-ru"],
        ["component", "panel"],
      ],
    );
  });
});
