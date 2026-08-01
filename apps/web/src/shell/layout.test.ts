import { describe, expect, it } from "vitest";

import {
  clampPanelWidth,
  defaultLayout,
  layoutStorageKey,
  panelWidthLimits,
  readLayout,
  writeLayout,
  type LayoutStorage,
} from "./layout.ts";

function storage(initial?: string): LayoutStorage & { written: () => string | undefined } {
  let value = initial;

  return {
    getItem: () => value ?? null,
    setItem: (_key, next) => {
      value = next;
    },
    written: () => value,
  };
}

describe("readLayout", () => {
  it("takes an empty browser for the default layout", () => {
    expect(readLayout(storage())).toEqual(defaultLayout);
  });

  it("restores the widths, the open tab and the hidden flags", () => {
    const kept = {
      leftWidth: 300,
      rightWidth: 400,
      openTab: "diagnostics",
      leftHidden: false,
      rightHidden: true,
    };

    expect(readLayout(storage(JSON.stringify(kept)))).toEqual(kept);
  });

  it("defaults the hidden flags when the entry does not carry them", () => {
    // Запись без новых полей — от платформы, которая о них не знала: берутся значения по умолчанию,
    // а не «отсутствует», иначе панель без флага читалась бы как видимое `undefined`.
    const restored = readLayout(
      storage(JSON.stringify({ leftWidth: 300, rightWidth: 400, openTab: "diagnostics" })),
    );

    expect(restored.leftHidden).toBe(false);
    expect(restored.rightHidden).toBe(false);
  });

  it("keeps a closed right panel closed", () => {
    expect(readLayout(storage(JSON.stringify({ openTab: undefined }))).openTab).toBeUndefined();
  });

  it("does not fall over a broken entry", () => {
    expect(readLayout(storage("{ half"))).toEqual(defaultLayout);
    expect(readLayout(storage("null"))).toEqual(defaultLayout);
  });

  it("keeps any tab identifier as a string: the shell decides if it has that tab", () => {
    // Список вкладок ядра закрыли: их приносят плагины в срезе 12, и ядру список не описать. Хранится
    // любая строка, а «есть ли такая вкладка» проверяет сама оболочка — это её вкладки.
    expect(readLayout(storage(JSON.stringify({ openTab: "plugin:tracker:board" }))).openTab).toBe(
      "plugin:tracker:board",
    );
    expect(readLayout(storage(JSON.stringify({ openTab: 7 }))).openTab).toBeUndefined();
  });

  it("pulls a width outside the limits back in", () => {
    const layout = readLayout(storage(JSON.stringify({ leftWidth: 3, rightWidth: 9000 })));

    expect(layout.leftWidth).toBe(panelWidthLimits.minimum);
    expect(layout.rightWidth).toBe(panelWidthLimits.maximum);
  });
});

describe("clampPanelWidth", () => {
  it("refuses a width that is not a number", () => {
    expect(clampPanelWidth(Number.NaN)).toBe(defaultLayout.leftWidth);
  });

  it("rounds to whole pixels", () => {
    expect(clampPanelWidth(260.4)).toBe(260);
  });
});

describe("writeLayout", () => {
  it("writes under the key the browser reads back", () => {
    const kept = storage();

    writeLayout(kept, { ...defaultLayout, leftWidth: 300 });

    expect(readLayout(kept).leftWidth).toBe(300);
    expect(layoutStorageKey).toBe("sovereign.layout");
  });
});
