import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { installTestHost } from "@sovereign/sdk/testing";

describe("the base agent plugin", () => {
  it("contributes exactly one agent with instructions and the whole tool set", async () => {
    const host = installTestHost({ id: "base-agent", source: "builtin" });

    // Порядок обязателен: сначала шов, потом импорт воркера (docs/plugins.md).
    const { activate } = await import("./worker.ts");

    await activate?.();

    assert.equal(host.contributions.length, 1);

    const [contribution] = host.contributions;

    assert.equal(contribution?.kind, "agent");
    assert.equal(contribution?.id, "agent");
    assert.deepEqual(contribution?.kind === "agent" ? contribution.tools : undefined, {
      include: ["*"],
    });
    assert.ok(
      contribution?.kind === "agent" && contribution.instructions.trim().length > 0,
      "агент без инструкций не регистрируется ядром вовсе",
    );

    // Модели по умолчанию у базового агента нет намеренно: платформа не знает, в какого провайдера
    // вошёл этот человек, и названная модель падала бы у всех остальных.
    assert.equal(contribution?.kind === "agent" ? contribution.model : "нет", undefined);

    host.restore();
  });
});
