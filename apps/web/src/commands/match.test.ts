import { describe, expect, it } from "vitest";

import { matchesQuery } from "./match.ts";

describe("matching a command by what was typed", () => {
  it("shows everything while nothing is typed", () => {
    expect(matchesQuery("", "Скрыть левую панель")).toBe(true);
    expect(matchesQuery("   ", "Скрыть левую панель")).toBe(true);
  });

  it("ignores the case and the register of both sides", () => {
    expect(matchesQuery("ПАНЕЛЬ", "Скрыть левую панель")).toBe(true);
    expect(matchesQuery("panel", "Hide the side PANEL")).toBe(true);
  });

  /** Порядок слов не важен: помнить формулировку целиком человек не обязан. */
  it("takes the words of the query in any order", () => {
    expect(matchesQuery("панель скрыть", "Скрыть левую панель")).toBe(true);
    expect(matchesQuery("скр пан", "Скрыть левую панель")).toBe(true);
  });

  it("requires every word, not just one of them", () => {
    expect(matchesQuery("скрыть провайдера", "Скрыть левую панель")).toBe(false);
  });

  /** Буква через букву не совпадает: нечёткого поиска здесь нет намеренно. */
  it("does not match a scattered subsequence of letters", () => {
    expect(matchesQuery("сп", "Скрыть левую панель")).toBe(false);
  });
});
