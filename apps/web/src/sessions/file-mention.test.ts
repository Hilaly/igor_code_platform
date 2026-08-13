import { describe, expect, it } from "vitest";

import { applyMention, mentionAt } from "./file-mention.ts";

describe("mentionAt", () => {
  it("sees a mention being typed at the caret", () => {
    expect(mentionAt("@src/ma", 7)).toEqual({ start: 0, end: 7, query: "src/ma" });
    expect(mentionAt("посмотри @rea", 13)).toEqual({ start: 9, end: 13, query: "rea" });
    // Только что нажатая `@` — уже ссылка: подсказка открывается с начала списка.
    expect(mentionAt("@", 1)).toEqual({ start: 0, end: 1, query: "" });
  });

  it("leaves an at-sign inside a word alone", () => {
    // Адрес почты ссылкой на файл не является, и открывать над ним подсказку неуместно.
    expect(mentionAt("пиши на me@example.com", 22)).toBeUndefined();
  });

  it("ends the mention at whitespace", () => {
    expect(mentionAt("@src/main.ts дальше", 19)).toBeUndefined();
    expect(mentionAt("@src/main.ts ", 13)).toBeUndefined();
  });

  it("looks only behind the caret, not at the whole text", () => {
    // Курсор стоит до `@`: человек правит начало строки, и подсказке взяться неоткуда.
    expect(mentionAt("текст @src", 5)).toBeUndefined();
  });

  it("takes an at-sign after an opening bracket", () => {
    expect(mentionAt("(@doc", 5)).toEqual({ start: 1, end: 5, query: "doc" });
  });
});

describe("applyMention", () => {
  it("replaces what was typed and leaves the caret past the inserted path", () => {
    const mention = mentionAt("посмотри @rea", 13);
    const applied = applyMention("посмотри @rea", mention!, "src/reader.ts");

    expect(applied.text).toBe("посмотри @src/reader.ts ");
    expect(applied.caret).toBe(applied.text.length);
  });

  it("keeps whatever followed the mention", () => {
    const mention = mentionAt("@rea и ещё", 4);
    const applied = applyMention("@rea и ещё", mention!, "readme.md");

    expect(applied.text).toBe("@readme.md  и ещё");
    expect(applied.caret).toBe("@readme.md ".length);
  });
});
