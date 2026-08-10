import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import type { ColorSchemeDocument } from "@sovereign/protocol";
import { describe, expect, it } from "vitest";

import { paletteVariants } from "./palette.ts";
import { parseColorScheme, resolveScheme } from "./scheme.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const referencePath = join(
  repositoryRoot,
  "plugins/starter/skills/plugin-backend/references/sdk-reference.md",
);

describe("the starter backend skill", () => {
  it("ships a color scheme accepted by the browser token contract", () => {
    const contribution = colorSchemeContribution(readFileSync(referencePath, "utf8"));
    const parsed = parseColorScheme("starter.midnight", contribution.scheme);

    expect(parsed).toMatchObject({ kind: "parsed" });
    if (parsed.kind !== "parsed") {
      return;
    }

    for (const variant of paletteVariants) {
      expect(resolveScheme(parsed.scheme, variant), variant).toMatchObject({ kind: "resolved" });
    }
  });
});

function colorSchemeContribution(markdown: string): { scheme: ColorSchemeDocument } {
  const fence = [...markdown.matchAll(/^```ts\r?\n([\s\S]*?)^```/gmu)]
    .map((match) => match[1] ?? "")
    .find((code) => code.includes("contribute.colorScheme"));
  if (fence === undefined) {
    throw new Error("plugin-backend has no color scheme example");
  }

  const argument = /await contribute\.colorScheme\(([\s\S]+)\);\s*$/u.exec(fence)?.[1];
  if (argument === undefined) {
    throw new Error("the color scheme example is not a direct contribution");
  }

  const contribution: unknown = runInNewContext(`(${argument})`, Object.create(null));
  if (!isRecord(contribution) || !isColorSchemeDocument(contribution["scheme"])) {
    throw new Error("the color scheme example has no ColorSchemeDocument");
  }
  return { scheme: contribution["scheme"] };
}

function isColorSchemeDocument(value: unknown): value is ColorSchemeDocument {
  return (
    isRecord(value) && typeof value["tokenContract"] === "number" && isRecord(value["variants"])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
