// @vitest-environment jsdom

import type { ContributionRegistration, PluginStatus } from "@sovereign/protocol";
import { coreEnglish, coreNamespace, createTranslator } from "@sovereign/ui-kit";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BrowserRuntimeProvider } from "../places/place-host.tsx";
import { defaultLayout, type ShellLayout } from "../shell/layout.ts";
import { CommandPalette, useCommandPaletteShortcut } from "./command-palette.tsx";
import type { CoreCommandHost } from "./core-commands.ts";

afterEach(cleanup);

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

function palette(
  options: {
    layout?: ShellLayout;
    contributions?: readonly ContributionRegistration[];
    onClose?: () => void;
    ran?: string[];
  } = {},
): CoreCommandHost & { navigate: ReturnType<typeof vi.fn> } {
  const ran = options.ran ?? [];
  const host: CoreCommandHost & { navigate: ReturnType<typeof vi.fn> } = {
    layout: options.layout ?? defaultLayout,
    navigate: vi.fn(),
    onLayoutChange: vi.fn(),
  };

  render(
    <BrowserRuntimeProvider
      contributions={options.contributions ?? []}
      plugins={[placed]}
      onDiagnostic={() => {}}
      cache={{
        moduleOf: () => ({
          kind: "loaded",
          module: { RunCommand: { run: () => ran.push("plugin command") } },
        }),
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

const rows = (): string[] => screen.queryAllByRole("listitem").map((row) => row.textContent ?? "");

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

    fireEvent.change(screen.getByRole("searchbox", { name: "Find a command" }), {
      target: { value: "board" },
    });

    expect(rows()).toEqual(["Run the board"]);
  });

  it("says so when nothing goes by that name", () => {
    palette();

    fireEvent.change(screen.getByRole("searchbox", { name: "Find a command" }), {
      target: { value: "nothing of the sort" },
    });

    expect(screen.getByText("No command goes by that name")).toBeDefined();
    expect(rows()).toEqual([]);
  });

  it("runs a core command and closes itself", () => {
    const onClose = vi.fn();
    const host = palette({ onClose });

    fireEvent.click(screen.getByRole("button", { name: "New session" }));

    expect(host.navigate).toHaveBeenCalledWith({ kind: "new-session" });
    expect(onClose).toHaveBeenCalled();
  });

  it("runs a plugin command through the same list", async () => {
    const ran: string[] = [];

    palette({ contributions: [runCommand], ran });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Run the board" }));
    });

    expect(ran).toEqual(["plugin command"]);
  });

  it("runs the first available command on Enter", () => {
    const host = palette();

    const field = screen.getByRole("searchbox", { name: "Find a command" });

    fireEvent.change(field, { target: { value: "archive" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(host.navigate).toHaveBeenCalledWith({ kind: "session-archive" });
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();

    palette({ onClose });
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalled();
  });

  /** Недоступная команда видна, но выбрать её нечем: строка списка, а не кнопка. */
  it("leaves an unavailable command in the list without a way to pick it", () => {
    palette({ layout: { ...defaultLayout, rightHidden: true } });

    expect(rows()).toContain("Hide the side panel");
    expect(screen.queryByRole("button", { name: "Hide the side panel" })).toBeNull();
    expect(screen.getByRole("button", { name: "Show the side panel" })).toBeDefined();
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
});
