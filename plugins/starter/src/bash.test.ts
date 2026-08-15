/**
 * Инструменты bash/job-output/job-kill (docs/bash-tool.md): живые процессы, настоящие лимиты.
 *
 * Каждый тест держит свой каталог данных: spill-файлы падают в `<root>/tmp`, и уборка не зависит
 * от реестра заданий.
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { installTestHost } from "@sovereign/sdk/testing";
import type { PluginToolInvocation, PluginToolOutcome } from "@sovereign/sdk";

import { contributeBashTools } from "./tools.ts";
import { killJobsOfSession } from "./bash.ts";

type TestHost = ReturnType<typeof installTestHost>;

let host: TestHost | undefined;
const roots: string[] = [];

afterEach(() => {
  killJobsOfSession("s1");
  killJobsOfSession("s2");
  host?.restore();
  host = undefined;
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

type Call = (
  id: string,
  args: unknown,
  invocation?: Partial<PluginToolInvocation>,
) => Promise<PluginToolOutcome>;

async function ready(): Promise<{ call: Call; root: string }> {
  host = installTestHost({ id: "starter", source: "builtin" });
  await contributeBashTools();

  const root = mkdtempSync(join(tmpdir(), "starter-bash-"));
  roots.push(root);

  const base: PluginToolInvocation = {
    sessionId: "s1",
    projectId: "p1",
    folder: root,
    dataDirectory: root,
    callTimeoutMilliseconds: 120_000,
  };

  return {
    call: async (id, args, invocation) =>
      (await host!.callTool(id, args, { ...base, ...invocation })) as PluginToolOutcome,
    root,
  };
}

const asText = (outcome: PluginToolOutcome) =>
  typeof outcome === "string" ? outcome : outcome.content;

describe("bash", () => {
  it("reports the exit code as a marker, not as an error", async () => {
    const { call } = await ready();

    const outcome = await call("bash", { command: "exit 3" });

    assert.equal(typeof outcome === "object" && outcome.isError, false);
    assert.match(asText(outcome), /\[exit code: 3\]/u);
  });

  it("sections stderr after stdout", async () => {
    const { call } = await ready();

    const outcome = await call("bash", { command: "echo out; echo err >&2" });

    assert.match(asText(outcome), /out/);
    assert.match(asText(outcome), /\[stderr\]\nerr/);
  });

  it("says (no output) for an empty result", async () => {
    const { call } = await ready();

    const outcome = await call("bash", { command: "true" });

    assert.match(asText(outcome), /\(no output\)/);
  });

  it("keeps a bounded tail and spills the full output to <dataDirectory>/tmp", async () => {
    const { call, root } = await ready();

    const outcome = await call("bash", { command: "seq 1 50000" });

    const content = asText(outcome);
    const match = content.match(/\[output truncated; full output: ([^\]]+)\]/u);
    assert.ok(match, "усечение обязано назвать файл с полным выводом");

    const spillPath = match[1]!;
    assert.ok(spillPath.startsWith(join(root, "tmp")), `файл в tmp-каталоге данных: ${spillPath}`);
    assert.ok(existsSync(spillPath));
    assert.match(content, /50000/u, "хвост держит конец вывода");
    assert.ok(readFileSync(spillPath, "utf8").startsWith("1"), "файл держит начало вывода");
  });

  it("clamps the model timeout to the plugin call cap with a margin", async () => {
    const { call } = await ready();

    // Потолок 5 с, запас 2 с → эффективные 3 секунды.
    const outcome = await call(
      "bash",
      { command: "true", timeout: 100 },
      { callTimeoutMilliseconds: 5_000 },
    );

    assert.match(asText(outcome), /\[timeout clamped to 3 seconds by the platform\]/);
  });

  it("times out a hanging command and reports it", async () => {
    const { call } = await ready();

    const started = Date.now();
    const outcome = await call("bash", { command: "sleep 5", timeout: 1 });
    const elapsed = Date.now() - started;

    assert.match(asText(outcome), /\[timed out after 1 seconds\]/);
    assert.ok(elapsed < 4_000, `таймаут сработал быстро, а не через 5 секунд: ${elapsed} мс`);
  });

  it("kills the whole process tree on timeout, not just the shell", async () => {
    const { call } = await ready();

    const outcome = await call("bash", { command: "sleep 30 & echo $!; wait", timeout: 1 });
    const pid = Number(asText(outcome).match(/^(\d+)$/mu)?.[1]);

    assert.ok(Number.isInteger(pid) && pid > 0, `детский pid в выводе: ${asText(outcome)}`);
    await assert.doesNotReject(async () => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (!alive(pid)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.fail("спящий потомок пережил таймаут родителя");
    });
  });

  it("runs in the background and returns a job id", async () => {
    const { call } = await ready();

    const outcome = await call("bash", { command: "true", run_in_background: true });

    assert.match(asText(outcome), /background job .* started/u);
  });
});

describe("job-output", () => {
  it("reads deltas and the final status of a background job", async () => {
    const { call } = await ready();

    const started = await call("bash", {
      command: "printf 'one\n'; sleep 0.3; printf 'two\n'",
      run_in_background: true,
    });
    const jobId = jobIdOf(started);
    assert.ok(jobId, `id задания в ответе: ${asText(started)}`);

    const seen: string[] = [];
    let status = "";
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const read = await call("job-output", { jobId });
      const content = asText(read);
      status = content.match(/\[status: ([a-z]+)\]/u)?.[1] ?? "";
      if (!/\(no new output\)/u.test(content)) seen.push(content);
      if (status === "completed") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    assert.equal(status, "completed");
    assert.ok(seen.join("\n").includes("one"), "первая дельта доехала");
    assert.ok(seen.join("\n").includes("two"), "вторая дельта доехала");
  });

  it("refuses a job of another session", async () => {
    const { call } = await ready();

    const started = await call("bash", { command: "sleep 30", run_in_background: true });
    const jobId = jobIdOf(started)!;

    const outcome = await call("job-output", { jobId }, { sessionId: "s2" });

    assert.equal(typeof outcome === "object" && outcome.isError, true);
    assert.match(asText(outcome), /belongs to another session/u);
  });

  it("names an unknown job instead of pretending", async () => {
    const { call } = await ready();

    const outcome = await call("job-output", { jobId: "no-such-job" });

    assert.equal(typeof outcome === "object" && outcome.isError, true);
    assert.match(asText(outcome), /unknown job no-such-job/u);
  });
});

describe("job-kill", () => {
  it("kills the whole tree of a running job", async () => {
    const { call } = await ready();

    const started = await call("bash", {
      command: "sleep 30 & echo $!; wait",
      run_in_background: true,
    });
    const jobId = jobIdOf(started)!;

    // Детский pid приходит не в ответе на запуск, а первым выводом задания — через job-output.
    let childPid = NaN;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const read = await call("job-output", { jobId });
      childPid = Number(asText(read).match(/^(\d+)$/mu)?.[1]);
      if (Number.isInteger(childPid) && childPid > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(Number.isInteger(childPid) && childPid > 0, "детский pid приходит выводом задания");

    const killed = await call("job-kill", { jobId });

    assert.equal(typeof killed === "object" && killed.isError, false);
    assert.match(asText(killed), /killed job/u);
    await assert.doesNotReject(async () => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (!alive(childPid)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.fail("спящий потомок пережил job-kill");
    });

    const read = await call("job-output", { jobId });
    assert.match(asText(read), /\[status: killed\]/u);
  });

  it("says the job is already finished on a second kill", async () => {
    const { call } = await ready();

    const started = await call("bash", { command: "true", run_in_background: true });
    const jobId = jobIdOf(started)!;

    // Даём команде закончиться.
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const read = await call("job-output", { jobId });
      if (/\[status: completed\]/u.test(asText(read))) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const killed = await call("job-kill", { jobId });

    assert.equal(typeof killed === "object" && killed.isError, false);
    assert.match(asText(killed), /already finished/u);
  });
});

/** id задания из ответа bash с run_in_background. */
function jobIdOf(outcome: PluginToolOutcome): string | undefined {
  return asText(outcome).match(/background job ([^\s]+) started/u)?.[1];
}

/** Жив ли процесс: `kill(pid, 0)` бросает ESRCH для мёртвого. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
