import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultDataDirectory, defaultPort, parseArguments } from "./arguments.ts";

test("launch without arguments uses the defaults", () => {
  assert.deepEqual(parseArguments([]), {
    kind: "run",
    options: { dataDirectory: defaultDataDirectory, port: defaultPort },
  });
});

test("the positional argument is the data directory", () => {
  assert.deepEqual(parseArguments(["/srv/sovereign"]), {
    kind: "run",
    options: { dataDirectory: "/srv/sovereign", port: defaultPort },
  });
});

test("the port is accepted both as a separate value and after an equals sign", () => {
  const separate = parseArguments(["--port", "9000"]);
  const attached = parseArguments(["--port=9000"]);

  assert.deepEqual(separate, {
    kind: "run",
    options: { dataDirectory: defaultDataDirectory, port: 9000 },
  });
  assert.deepEqual(attached, separate);
});

test("the order of the directory and the port does not matter", () => {
  assert.deepEqual(parseArguments(["--port", "9000", "/srv/sovereign"]), {
    kind: "run",
    options: { dataDirectory: "/srv/sovereign", port: 9000 },
  });
});

test("a port that is not a decimal integer is refused", () => {
  for (const value of ["8787.0", "0x2253", "8.7e3", "port", ""]) {
    assert.equal(parseArguments(["--port", value]).kind, "error", `accepted ${value}`);
  }
});

test("a port outside 1-65535 is refused", () => {
  for (const value of ["0", "65536", "999999"]) {
    assert.equal(parseArguments(["--port", value]).kind, "error", `accepted ${value}`);
  }
});

test("a port without a value is refused", () => {
  assert.equal(parseArguments(["--port"]).kind, "error");
});

test("an unknown option is refused and names itself", () => {
  const parsed = parseArguments(["--verbose"]);

  assert.equal(parsed.kind, "error");
  assert.match(parsed.kind === "error" ? parsed.message : "", /--verbose/);
});

test("a second positional argument is refused", () => {
  assert.equal(parseArguments(["/srv/sovereign", "/srv/other"]).kind, "error");
});

test("--help returns the usage text instead of running", () => {
  const parsed = parseArguments(["--help"]);

  assert.equal(parsed.kind, "help");
  assert.match(parsed.kind === "help" ? parsed.text : "", /--port/);
});
