import { resolve } from "node:path";

import { seedRunbookFixtures } from "./runbook-fixtures.ts";

try {
  const receivedArguments = process.argv.slice(2);
  const arguments_ = receivedArguments[0] === "--" ? receivedArguments.slice(1) : receivedArguments;

  if (arguments_.length !== 1) {
    throw new Error("expected exactly one data-directory argument");
  }

  const argument = arguments_[0];

  if (argument === undefined) {
    throw new Error("expected exactly one data-directory argument");
  }

  const dataDirectory = resolve(argument);
  await seedRunbookFixtures({ dataDirectory });
  process.stdout.write(`${dataDirectory}\n`);
} catch (cause) {
  process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
  process.exitCode = 1;
}
