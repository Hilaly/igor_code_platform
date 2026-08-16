// @vitest-environment jsdom

import type { ContributionRegistration, PluginStatus } from "@sovereign/protocol";
import { coreEnglish, coreNamespace, createTranslator } from "@sovereign/ui-kit";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import { BrowserRuntimeProvider } from "../places/place-host.tsx";
import { defaultLayout, type ShellLayout } from "../shell/layout.ts";
import { CommandPalette, useCommandPaletteShortcut } from "./command-palette.tsx";
import type { CoreCommandHost } from "./core-commands.ts";

afterEach(() => {
  cleanup();
  asked.length = 0;
  peeked.length = 0;
});

const translator = createTranslator({
  catalogs: [coreEnglish],
  locale: "en",
  namespace: coreNamespace,
  onDiagnostic: () => {},
});

const placed: PluginStatus = {
  key: "data:placed",
  id: "placed",
  source: "data",
  directory: "/plugins/placed",
  state: "running",
  browser: { revision: "r1", entry: "/plugin-assets/placed/r1/browser.js" },
};

const runCommand: ContributionRegistration = {
  ownership: "plugin",
  pluginKey: placed.key,
  pluginId: "placed",
  source: "data",
  kind: "command",
  id: "placed.run",
  declaredId: "run",
  title: "Run the board",
  export: "RunCommand",
};

const asked: string[] = [];
const peeked: string[] = [];

function palette(
  options: {
    layout?: ShellLayout;
    contributions?: readonly ContributionRegistration[];
    onClose?: () => void;
    ran?: string[];
    cacheEmpty?: boolean;
    pluginModule?: Record<string, unknown>;
    onDiagnostic?: (text: string) => void;
  } = {},
): CoreCommandHost & { navigate: Mock<CoreCommandHost["navigate"]> } {
  const ran = options.ran ?? [];
  const pluginModule =
    options.pluginModule ?? ({ RunCommand: { run: () => ran.push("plugin command") } } as const);
  const cached = options.cacheEmpty
    ? undefined
    : ({ kind: "loaded", module: pluginModule } as const);
  const host: CoreCommandHost & { navigate: Mock<CoreCommandHost["navigate"]> } = {
    layout: options.layout ?? defaultLayout,
    navigate: vi.fn<CoreCommandHost["navigate"]>(),
    onLayoutChange: vi.fn<CoreCommandHost["onLayoutChange"]>(),
    rightUnavailable: false,
  };

  render(
    <BrowserRuntimeProvider
      contributions={options.contributions ?? []}
      plugins={[placed]}
      onDiagnostic={options.onDiagnostic ?? (() => {})}
      events={{ subscribe: () => () => {} }}
      locale="en"
      cache={{
        load: (status) => {
          asked.push(status.key);

          return cached ?? { kind: "loading" };
        },
        peek: (status) => {
          peeked.push(status.key);
          return cached;
        },
        version: () => 0,
        retain: () => {},
        subscribe: () => () => {},
        dispose: () => {},
      }}
    >
      <CommandPalette
        open
        onClose={options.onClose ?? (() => {})}
        host={host}
        context={{ subject: { page: "home" } }}
        translator={translator}
      />
    </BrowserRuntimeProvider>,
  );

  return host;
}

/** Строки палитры — опции listbox: фокус живёт в поле поиска, и кнопкой строка быть не вправе. */
const rows = (): string[] => screen.queryAllByRole("option").map((row) => row.textContent ?? "");

/** Ярлыки групп: оглавление палитры, а не строки списка. Имя группе даёт её видимый ярлык. */
const groups = (): string[] =>
  screen.queryAllByRole("group").map((group) => {
    const labelId = group.getAttribute("aria-labelledby") ?? "";

    return document.getElementById(labelId)?.textContent ?? "";
  });

const row = (name: string): HTMLElement => screen.getByRole("option", { name });

const field = (): HTMLElement => screen.getByRole("combobox", { name: "Find a command" });

describe("the command palette", () => {
  /**
   * Главное, ради чего команды ядра объявлены данными хоста: на чистой установке без единого
   * плагина палитре есть что показать.
   */
  it("has commands to show with no plugin installed at all", () => {
    palette();

    expect(rows()).toContain("New session");
    expect(rows().length).toBeGreaterThan(1);
  });

  /** Для человека это одинаковые действия, поэтому источник в списке не выделен ничем. */
  it("puts the commands of the core and of a plugin into one list", () => {
    palette({ contributions: [runCommand] });

    expect(rows()).toContain("New session");
    expect(rows()).toContain("Run the board");
  });

  it("filters by a substring of the title", () => {
    palette({ contributions: [runCommand] });

    fireEvent.change(field(), { target: { value: "board" } });

    expect(rows()).toEqual(["Run the board"]);
  });

  it("says so when nothing goes by that name", () => {
    palette();

    fireEvent.change(field(), { target: { value: "nothing of the sort" } });

    expect(screen.getByText("No command goes by that name")).toBeDefined();
    expect(rows()).toEqual([]);
  });

  it("runs a core command and closes itself", () => {
    const onClose = vi.fn();
    const host = palette({ onClose });

    fireEvent.click(row("New session"));

    expect(host.navigate).toHaveBeenCalledWith({ kind: "new-session" });
    expect(onClose).toHaveBeenCalled();
  });

  it("runs a plugin command through the same list", async () => {
    const ran: string[] = [];

    palette({ contributions: [runCommand], ran });

    await act(async () => {
      fireEvent.click(row("Run the board"));
    });

    expect(ran).toEqual(["plugin command"]);
  });

  it("runs the first available command on Enter", () => {
    const host = palette();

    fireEvent.change(field(), { target: { value: "archive" } });
    fireEvent.keyDown(field(), { key: "Enter" });

    expect(host.navigate).toHaveBeenCalledWith({ kind: "session-archive" });
  });

  /**
   * Палитра читает только снимок: чтобы показать команды плагинов, загружать их бандлы не нужно.
   * Иначе открытие палитры тянуло бы код каждого установленного плагина разом.
   */
  it("shows plugin commands without loading a single bundle", () => {
    palette({ contributions: [runCommand], cacheEmpty: true });

    expect(rows()).toContain("Run the board");
    expect(row("Run the board")).toBeDefined();
    expect(peeked).toEqual([placed.key]);
    expect(asked).toEqual([]);
  });

  it("keeps a cached unavailable plugin command visible as a disabled button", () => {
    palette({
      contributions: [runCommand],
      pluginModule: { RunCommand: { run: () => {}, available: () => false } },
    });

    expect(rows()).toContain("Run the board");
    expect(row("Run the board").getAttribute("aria-disabled")).toBe("true");
    expect(asked).toEqual([]);
  });

  it("contains a broken plugin availability predicate and reports it after render", async () => {
    const diagnostics: string[] = [];

    palette({
      contributions: [runCommand],
      pluginModule: {
        RunCommand: {
          run: () => {},
          available: () => {
            throw new Error("availability broke");
          },
        },
      },
      onDiagnostic: (text) => diagnostics.push(text),
    });

    expect(rows()).toContain("Run the board");
    expect(row("Run the board").getAttribute("aria-disabled")).toBe("true");
    await act(async () => {});
    expect(diagnostics).toEqual([
      "the command placed.run could not determine availability: availability broke",
    ]);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();

    palette({ onClose });
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalled();
  });

  /** Недоступная команда сохраняет строку и место в списке, но выбора не принимает. */
  it("leaves an unavailable command in the list as a disabled option", () => {
    const onClose = vi.fn();
    const host = palette({ layout: { ...defaultLayout, rightHidden: true }, onClose });

    expect(rows()).toContain("Hide the side panel");
    expect(row("Hide the side panel").getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(row("Hide the side panel"));
    expect(host.onLayoutChange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(row("Show the side panel").hasAttribute("aria-disabled")).toBe(false);
  });

  /**
   * Оглавление вместо одного списка: группа отвечает, куда ведёт команда, прежде чем читать подписи.
   * Команды плагина стоят группой с его именем — источник виден без чтения идентификатора.
   */
  it("splits the list into groups and names the plugin group after the plugin", () => {
    palette({ contributions: [runCommand] });

    expect(groups()).toEqual(["Sessions", "Settings", "Panels", "placed"]);
  });

  /** Пустая группа не показывается: ярлык над ничем говорит о разделе, которого в отборе нет. */
  it("drops a group with nothing left in it", () => {
    palette({ contributions: [runCommand] });

    fireEvent.change(field(), { target: { value: "board" } });

    expect(groups()).toEqual(["placed"]);
  });

  /**
   * Стрелки ходят по всему списку и перешагивают недоступные строки: активная строка это та, которую
   * заберёт `Enter`, и остановка на невыполнимой команде обманывала бы.
   */
  it("moves the active row with the arrows across groups and skips the unavailable", () => {
    const host = palette({ layout: { ...defaultLayout, rightHidden: true } });
    const selected = (): string | undefined =>
      screen
        .queryAllByRole("option")
        .find((option) => option.getAttribute("aria-selected") === "true")?.textContent ??
      undefined;

    expect(selected()).toBe("New session");

    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(selected()).toBe("Open the archive");

    fireEvent.keyDown(field(), { key: "End" });
    fireEvent.keyDown(field(), { key: "ArrowUp" });
    expect(selected()).not.toBe("Hide the side panel");

    fireEvent.keyDown(field(), { key: "Home" });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(host.navigate).toHaveBeenCalledWith({ kind: "new-session" });
  });
});

describe("the command palette shortcut", () => {
  function Probe(): ReactNode {
    const [count, setCount] = useState(0);

    useCommandPaletteShortcut(() => setCount((previous) => previous + 1));

    return <p>{`opened ${count}`}</p>;
  }

  it("opens on Cmd or Ctrl+K and takes the chord away from the browser", () => {
    render(<Probe />);

    const event = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, cancelable: true });

    act(() => {
      window.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByText("opened 1")).toBeDefined();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "K", metaKey: true }));
    });

    expect(screen.getByText("opened 2")).toBeDefined();
  });

  it("leaves a bare k alone", () => {
    render(<Probe />);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }));
    });

    expect(screen.getByText("opened 0")).toBeDefined();
  });

  it.each([
    { ctrlKey: true, shiftKey: true },
    { ctrlKey: true, altKey: true },
    { metaKey: true, shiftKey: true },
    { metaKey: true, altKey: true },
    { metaKey: true, ctrlKey: true },
  ])("leaves modified Cmd or Ctrl+K chords alone", (modifiers) => {
    render(<Probe />);
    const event = new KeyboardEvent("keydown", {
      key: "k",
      cancelable: true,
      ...modifiers,
    });

    act(() => window.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(false);
    expect(screen.getByText("opened 0")).toBeDefined();
  });
});
