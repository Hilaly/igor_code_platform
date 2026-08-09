import { coreEnglish, coreRussian } from "@sovereign/ui-kit";
import { describe, expect, it, vi } from "vitest";

import { defaultLayout } from "../shell/layout.ts";
import { coreCommands, type CoreCommandHost } from "./core-commands.ts";

function host(
  layout = defaultLayout,
  rightUnavailable = false,
): CoreCommandHost & {
  navigate: ReturnType<typeof vi.fn>;
  onLayoutChange: ReturnType<typeof vi.fn>;
  rightUnavailable: boolean;
} {
  return { layout, navigate: vi.fn(), onLayoutChange: vi.fn(), rightUnavailable };
}

const command = (id: string) => {
  const found = coreCommands.find((candidate) => candidate.id === id);

  expect(found, `no core command ${id}`).toBeDefined();

  return found!;
};

describe("core commands", () => {
  it("names every command in the namespace of the core and only once", () => {
    const ids = coreCommands.map((candidate) => candidate.id);

    expect(ids.filter((id) => !id.startsWith("core."))).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /** Заголовок команды человек читает: без строки в обоих каталогах палитра показала бы ключ. */
  it("has a title in both shipped catalogs", () => {
    const missing = coreCommands.filter(
      (candidate) =>
        coreEnglish.messages[candidate.titleKey] === undefined ||
        coreRussian.messages[candidate.titleKey] === undefined,
    );

    expect(missing.map((candidate) => candidate.titleKey)).toEqual([]);
  });

  it("opens the screens the shell already has", () => {
    const shell = host();

    command("core.session.new").run(shell);
    command("core.settings.plugins").run(shell);

    expect(shell.navigate.mock.calls).toEqual([
      [{ kind: "new-session" }],
      [{ kind: "settings", section: "plugins" }],
    ]);
    expect(shell.onLayoutChange).not.toHaveBeenCalled();
  });

  it("shows and hides a panel through the layout the shell owns", () => {
    const shell = host({ ...defaultLayout, rightHidden: true });

    command("core.panel.right.show").run(shell);

    expect(shell.onLayoutChange).toHaveBeenLastCalledWith({
      ...defaultLayout,
      rightHidden: false,
    });
    expect(shell.navigate).not.toHaveBeenCalled();
  });

  /**
   * «Показать» и «скрыть» — разные команды, и лишняя из пары выключена, а не спрятана: исчезающая
   * строка заставляла бы искать её глазами вместо того, чтобы читать список.
   */
  it("switches off the half of a pair that would do nothing", () => {
    const hidden = host({ ...defaultLayout, rightHidden: true });
    const shown = host({ ...defaultLayout, rightHidden: false });

    expect(command("core.panel.right.show").available?.(hidden)).toBe(true);
    expect(command("core.panel.right.hide").available?.(hidden)).toBe(false);
    expect(command("core.panel.right.show").available?.(shown)).toBe(false);
    expect(command("core.panel.right.hide").available?.(shown)).toBe(true);
  });

  it("switches off both right-panel commands while the panel is unavailable", () => {
    const shell = host(defaultLayout, true);

    expect(command("core.panel.right.show").available?.(shell)).toBe(false);
    expect(command("core.panel.right.hide").available?.(shell)).toBe(false);
  });

  /** Скрытая правая панель открытой вкладки не имеет — то же, что делает кнопка оболочки. */
  it("closes the open tab together with the right panel", () => {
    const shell = host({ ...defaultLayout, rightHidden: false, openTab: "placed.board" });

    command("core.panel.right.hide").run(shell);

    expect(shell.onLayoutChange).toHaveBeenLastCalledWith({
      ...defaultLayout,
      rightHidden: true,
      openTab: undefined,
    });
  });
});
