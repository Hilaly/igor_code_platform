import { describe, expect, it } from "vitest";

import {
  applySlash,
  parseInvocation,
  skillInvocation,
  skillOf,
  slashAt,
  slashCatalogue,
} from "./slash-command.ts";

describe("slashAt", () => {
  it("sees a command being typed at the start of the draft", () => {
    expect(slashAt("/comp", 5)).toEqual({ end: 5, query: "comp" });
    // Только что нажатая `/` — уже команда: каталог открывается целиком.
    expect(slashAt("/", 1)).toEqual({ end: 1, query: "" });
  });

  it("leaves a slash inside the text alone", () => {
    // Иначе каталог открывался бы над каждым путём и над каждой датой.
    expect(slashAt("посмотри src/main.ts", 20)).toBeUndefined();
    expect(slashAt("12/03 сделано", 5)).toBeUndefined();
  });

  it("ends the command at whitespace: дальше идут аргументы", () => {
    expect(slashAt("/compact и покороче", 19)).toBeUndefined();
    expect(slashAt("/compact ", 9)).toBeUndefined();
  });

  it("looks only behind the caret", () => {
    expect(slashAt("/compact", 0)).toBeUndefined();
    expect(slashAt("/compact", 4)).toEqual({ end: 4, query: "com" });
  });
});

describe("applySlash", () => {
  it("replaces the typed name and leaves the rest of the draft in place", () => {
    expect(applySlash("/comp", { end: 5, query: "comp" }, "compact")).toEqual({
      text: "/compact ",
      caret: 9,
    });
    // Написанное до открытия каталога становится аргументом выбранной команды.
    expect(applySlash("/уже написано", { end: 1, query: "" }, "compact")).toEqual({
      text: "/compact уже написано",
      caret: 9,
    });
  });
});

describe("parseInvocation", () => {
  it("splits the command from what was written after it", () => {
    expect(parseInvocation("/compact")).toEqual({ name: "compact", arguments: "" });
    expect(parseInvocation("/rename срез 15")).toEqual({ name: "rename", arguments: "срез 15" });
    expect(parseInvocation("/skill:starter.review  начни с тестов")).toEqual({
      name: "skill:starter.review",
      arguments: "начни с тестов",
    });
  });

  it("takes an ordinary message for what it is", () => {
    expect(parseInvocation("посмотри src/main.ts")).toBeUndefined();
    expect(parseInvocation("/")).toBeUndefined();
    expect(parseInvocation(" /compact")).toBeUndefined();
  });
});

describe("skillOf and skillInvocation", () => {
  it("recognizes an explicit skill launch by its prefix", () => {
    expect(skillOf({ name: "skill:starter.review", arguments: "" })).toBe("starter.review");
    expect(skillOf({ name: "compact", arguments: "" })).toBeUndefined();
  });

  it("renders the launch the same way the catalogue inserts it", () => {
    expect(skillInvocation("starter.review")).toBe("/skill:starter.review");
    expect(skillInvocation("starter.review", "начни с тестов")).toBe(
      "/skill:starter.review начни с тестов",
    );
    expect(parseInvocation(skillInvocation("starter.review", "начни"))).toEqual({
      name: "skill:starter.review",
      arguments: "начни",
    });
  });
});

describe("slashCatalogue", () => {
  const core = [
    { name: "compact", description: "свернуть" },
    { name: "fork", description: "отделить" },
  ];
  const skills = [
    { name: "starter.review", description: "разбор", hidden: false },
    { name: "starter.deploy", description: "выкладка", hidden: true },
  ];

  it("puts the commands of the core first and the skills after them", () => {
    expect(slashCatalogue("", core, skills).map(({ name }) => name)).toEqual([
      "compact",
      "fork",
      "skill:starter.review",
      "skill:starter.deploy",
    ]);
  });

  it("finds a namespaced skill by the part the human remembers", () => {
    expect(slashCatalogue("review", core, skills).map(({ name }) => name)).toEqual([
      "skill:starter.review",
    ]);
  });

  it("keeps the mark of a skill the model cannot pick itself", () => {
    expect(slashCatalogue("deploy", core, skills)[0]?.hidden).toBe(true);
    expect(slashCatalogue("review", core, skills)[0]?.hidden).toBeUndefined();
  });
});
