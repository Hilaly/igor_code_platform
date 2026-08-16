import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseBashResult } from "./parse-bash-result.ts";

describe("parseBashResult", () => {
  it("keeps a plain output as stdout", () => {
    assert.deepEqual(parseBashResult("hello\nworld"), {
      stdout: "hello\nworld",
      stderr: "",
      noOutput: false,
    });
  });

  it("splits the stderr section off the body", () => {
    assert.deepEqual(parseBashResult("out\n[stderr]\nerr line"), {
      stdout: "out",
      stderr: "err line",
      noOutput: false,
    });
  });

  it("parses a non-zero exit code marker", () => {
    const parsed = parseBashResult("out\n[exit code: 2]");
    assert.equal(parsed.exitCode, 2);
    assert.equal(parsed.stdout, "out");
  });

  it("parses the timed-out marker including the platform cap wording", () => {
    assert.equal(parseBashResult("out\n[timed out after 30 seconds]").timedOut, true);
    assert.equal(parseBashResult("out\n[timed out after the platform cap seconds]").timedOut, true);
  });

  it("parses the killed-by-signal marker", () => {
    const parsed = parseBashResult("out\n[killed by signal: SIGKILL]");
    assert.equal(parsed.killedBy, "SIGKILL");
  });

  it("parses the clamped-timeout marker together with the timed-out marker", () => {
    const parsed = parseBashResult(
      "[timeout clamped to 118 seconds by the platform]\n[timed out after 118 seconds]",
    );
    assert.equal(parsed.clampedSeconds, 118);
    assert.equal(parsed.timedOut, true);
  });

  it("strips the truncated-output marker and keeps its path", () => {
    const parsed = parseBashResult("out\n[output truncated; full output: /tmp/bash-1.log]");
    assert.equal(parsed.stdout, "out");
    assert.equal(parsed.truncatedPath, "/tmp/bash-1.log");
  });

  it("keeps the stderr-section truncation marker as its own path", () => {
    const parsed = parseBashResult(
      "out\n[stderr]\nerr\n[output truncated; full output: /tmp/bash-1.stderr.log]",
    );
    assert.equal(parsed.stdout, "out");
    assert.equal(parsed.stderrTruncatedPath, "/tmp/bash-1.stderr.log");
  });

  it("parses the killed job status", () => {
    const parsed = parseBashResult("(no new output)\n[status: killed]");
    assert.equal(parsed.jobStatus, "killed");
  });

  it("treats an empty body as no output", () => {
    const parsed = parseBashResult("(no output)");
    assert.equal(parsed.noOutput, true);
    assert.equal(parsed.stdout, "");
  });

  it("treats a job delta without new output as no output with its status", () => {
    const parsed = parseBashResult("(no new output)\n[status: running]");
    assert.equal(parsed.noOutput, true);
    assert.equal(parsed.jobStatus, "running");
  });

  it("parses the completed job status and the dropped-memory notice", () => {
    const parsed = parseBashResult(
      "line\n[some output was dropped from memory; full output: /tmp/j.log]\n[status: completed]",
    );
    assert.equal(parsed.stdout, "line");
    assert.equal(parsed.truncatedPath, "/tmp/j.log");
    assert.equal(parsed.jobStatus, "completed");
  });

  it("keeps unknown text whole", () => {
    assert.deepEqual(parseBashResult("[not a marker] hello"), {
      stdout: "[not a marker] hello",
      stderr: "",
      noOutput: false,
    });
  });
});
