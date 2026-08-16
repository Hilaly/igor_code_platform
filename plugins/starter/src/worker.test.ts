import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { toolCallPlaceId, type PluginContribution } from "@sovereign/sdk";
import { installTestHost } from "@sovereign/sdk/testing";

import { findJob, startJob } from "./bash.ts";

describe("the starter plugin", () => {
  it("requires the model to read applicable project AGENTS.md files", () => {
    const prompt = readFileSync(new URL("../agents/generic/AGENT.md", import.meta.url), "utf8");

    assert.match(prompt, /read.*AGENTS\.md/isu);
    assert.match(prompt, /project.*root/isu);
    assert.match(prompt, /closer.*AGENTS\.md/isu);
    assert.match(prompt, /absent.*continue/isu);
  });

  it("requires the model to load every applicable skill before acting", () => {
    const prompt = readFileSync(new URL("../agents/generic/AGENT.md", import.meta.url), "utf8");

    assert.match(prompt, /<available_skills>/u);
    assert.match(prompt, /before any response or action/iu);
    assert.match(prompt, /clarifying question/iu);
    assert.match(prompt, /tool call/iu);
    assert.match(prompt, /user (?:names|requests)[\s\S]*skill/iu);
    assert.match(prompt, /matches[\s\S]*description/iu);
    assert.match(prompt, /read[\s\S]*complete[\s\S]*SKILL\.md[\s\S]*location/iu);
    assert.match(prompt, /current[\s\S]*SKILL\.md/iu);
    assert.match(prompt, /follow[\s\S]*instructions/iu);
    assert.match(prompt, /relative[\s\S]*skill(?:'s)?[\s\S]*directory/iu);
    assert.match(prompt, /process[\s\S]*before[\s\S]*(?:implementation|domain)/iu);
  });

  it("contributes the bash tools and the session-close cleanup on activation", async () => {
    const host = installTestHost({ id: "starter", source: "builtin" });

    // Порядок обязателен: сначала шов, потом импорт воркера (docs/plugins.md).
    const { activate } = await import("./worker.ts");

    await activate?.();

    const ids = host.contributions
      .map((contribution) =>
        contribution.kind === "tool"
          ? `tool:${contribution.id}`
          : contribution.kind === "hook"
            ? `hook:${contribution.id}:${contribution.event}`
            : contribution.kind,
      )
      .sort();

    assert.deepEqual(ids, [
      "component",
      "component",
      "component",
      "hook:bash-jobs-session-close:session_closed",
      "locale-catalog",
      "locale-catalog",
      "tool:bash",
      "tool:job-kill",
      "tool:job-output",
    ]);

    const isComponent = (
      contribution: PluginContribution,
    ): contribution is Extract<PluginContribution, { kind: "component" }> =>
      contribution.kind === "component";
    const components = host.contributions.filter(isComponent);
    assert.deepEqual(
      components.map((contribution) => ({
        id: contribution.id,
        placeId: contribution.placeId,
        export: contribution.export,
      })),
      [
        { id: "starter-bash-tool-call", placeId: toolCallPlaceId("bash"), export: "BashToolCall" },
        {
          id: "starter-job-output-tool-call",
          placeId: toolCallPlaceId("job-output"),
          export: "BashToolCall",
        },
        {
          id: "starter-job-kill-tool-call",
          placeId: toolCallPlaceId("job-kill"),
          export: "BashToolCall",
        },
      ],
    );

    const catalogs = host.contributions.filter(
      (contribution): contribution is Extract<PluginContribution, { kind: "locale-catalog" }> =>
        contribution.kind === "locale-catalog",
    );
    assert.deepEqual(
      catalogs.map((contribution) => contribution.locale).sort(),
      ["en", "ru"],
    );

    // Идентификаторы вкладов обязаны проходить валидацию реестра демона
    // (apps/daemon/src/plugins/contribution-registry.ts). Тестовый хост её не применяет — поэтому
    // регрессия с недопустимым id не была бы поймана одним deepEqual выше; паттерн — публичный
    // контракт платформы (docs/plugins.md).
    const idPattern = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*$/u;
    for (const contribution of host.contributions) {
      assert.match(contribution.id, idPattern, contribution.id);
    }

    host.restore();
  });

  it("kills the process trees of background jobs on deactivation", async () => {
    const host = installTestHost({ id: "starter", source: "builtin" });
    const root = mkdtempSync(join(tmpdir(), "starter-deactivate-"));

    try {
      const { activate, deactivate } = await import("./worker.ts");

      await activate?.();

      const job = startJob({
        command: "sleep 30",
        cwd: root,
        tmpDir: join(root, "tmp"),
        sessionId: "s1",
      });

      await deactivate?.();

      assert.equal(findJob(job.id), undefined, "реестр заданий пуст после выгрузки");
      await assert.doesNotReject(async () => {
        // SIGKILL группе уже отправлен: лидер дерева должен умереть в пределах grace.
        for (let attempt = 0; attempt < 100; attempt += 1) {
          if (!alive(job.handle.pid)) return;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        assert.fail("процесс пережил выгрузку плагина");
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
      host.restore();
    }
  });
});

/** Жив ли процесс: `kill(pid, 0)` бросает ESRCH для мёртвого. */
function alive(pid: number | undefined): boolean {
  if (pid === undefined) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
