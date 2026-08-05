// @vitest-environment jsdom

/**
 * Поведение оболочки на настоящем DOM. Первая часть — регресс на баг границ панелей:
 * `pointermove`-слушатель внутри `onPointerDown` замыкал устаревшую ширину и терял всё протаскивание,
 * кроме последнего кадра (shell.tsx, `PanelResizer`). Вторая — скрытие и возврат панелей.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";

import { Shell, type ShellProps } from "./shell.tsx";
import { defaultLayout, panelWidthLimits, type ShellLayout } from "./layout.ts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(cleanup);

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
});

const labels = {
  left: "левая панель",
  right: "правая панель",
  emptyTabs: "вкладок нет",
  hideLeft: "скрыть левую",
  hideRight: "скрыть правую",
  showLeft: "показать левую",
  showRight: "показать правую",
};

/** Левая панель по умолчанию видна, правая — нет: её вкладок у ядра больше нет. */
const rightVisible: ShellLayout = { ...defaultLayout, rightHidden: false, openTab: "appearance" };

function show(overrides: Partial<ShellProps> = {}) {
  const onLayoutChange = vi.fn();
  const props: ShellProps = {
    layout: defaultLayout,
    onLayoutChange,
    labels,
    navigation: <div>навигация</div>,
    status: <div>статус демона</div>,
    tabs: [],
    children: <div>страница</div>,
    ...overrides,
  };

  const { rerender } = render(<Shell {...props} />);

  return {
    onLayoutChange,
    again: (layout: ShellLayout, nextOverrides: Partial<ShellProps> = {}) =>
      rerender(<Shell {...props} {...nextOverrides} layout={layout} />),
  };
}

function drag(separator: HTMLElement, startX: number, moves: number[]): void {
  fireEvent.pointerDown(separator, { clientX: startX });

  for (const clientX of moves) {
    window.dispatchEvent(new PointerEvent("pointermove", { clientX }));
  }

  window.dispatchEvent(new PointerEvent("pointerup"));
}

describe("PanelResizer", () => {
  it("moves the left edge by the whole dragged distance, not just the last frame", () => {
    const { onLayoutChange } = show();
    const separator = screen.getByRole("separator", { name: "левая панель" });

    drag(separator, 100, [140, 180, 220]);

    expect(onLayoutChange).toHaveBeenLastCalledWith({
      ...defaultLayout,
      leftWidth: defaultLayout.leftWidth + 120,
    });
  });

  it("moves the right edge the opposite way of the cursor", () => {
    const { onLayoutChange } = show({
      layout: rightVisible,
      tabs: [{ id: "appearance", label: "Вид", content: <div>вид</div> }],
    });
    const separator = screen.getByRole("separator", { name: "правая панель" });

    drag(separator, 500, [480, 460]);

    expect(onLayoutChange).toHaveBeenLastCalledWith({
      ...rightVisible,
      rightWidth: defaultLayout.rightWidth + 40,
    });
  });

  it("stops listening once the pointer is released", () => {
    const { onLayoutChange } = show();
    const separator = screen.getByRole("separator", { name: "левая панель" });

    drag(separator, 100, [150]);
    onLayoutChange.mockClear();

    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 400 }));

    expect(onLayoutChange).not.toHaveBeenCalled();
  });

  it("clamps to the panel width limits", () => {
    const { onLayoutChange } = show();
    const separator = screen.getByRole("separator", { name: "левая панель" });

    drag(separator, 100, [-5000]);

    expect(onLayoutChange).toHaveBeenLastCalledWith({
      ...defaultLayout,
      leftWidth: panelWidthLimits.minimum,
    });
  });

  it("moves by 16px per arrow key, honouring the edge direction", () => {
    const { onLayoutChange } = show();
    const left = screen.getByRole("separator", { name: "левая панель" });

    fireEvent.keyDown(left, { key: "ArrowRight" });
    expect(onLayoutChange).toHaveBeenLastCalledWith({
      ...defaultLayout,
      leftWidth: defaultLayout.leftWidth + 16,
    });

    fireEvent.keyDown(left, { key: "ArrowLeft" });
    expect(onLayoutChange).toHaveBeenLastCalledWith({
      ...defaultLayout,
      leftWidth: defaultLayout.leftWidth - 16,
    });
  });

  it("announces and applies the viewport maximum", () => {
    const { onLayoutChange } = show();
    const left = screen.getByRole("separator", { name: "левая панель" });

    expect(left.getAttribute("aria-valuemin")).toBe(String(panelWidthLimits.minimum));
    expect(left.getAttribute("aria-valuemax")).toBe("1115");
    expect(left.getAttribute("aria-valuenow")).toBe(String(defaultLayout.leftWidth));

    drag(left, 100, [5000]);

    expect(onLayoutChange).toHaveBeenLastCalledWith({ ...defaultLayout, leftWidth: 1115 });
  });

  it("subtracts the visible opposite panel from each maximum", () => {
    show({ layout: rightVisible });

    expect(
      screen.getByRole("separator", { name: "левая панель" }).getAttribute("aria-valuemax"),
    ).toBe("790");
    expect(
      screen.getByRole("separator", { name: "правая панель" }).getAttribute("aria-valuemax"),
    ).toBe("850");
  });

  it("temporarily clamps rendered widths after a viewport resize", () => {
    show({ layout: { ...defaultLayout, leftWidth: 900 } });

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    fireEvent(window, new Event("resize"));

    expect(
      screen.getByRole("navigation", { name: "левая панель" }).getAttribute("style"),
    ).toContain("width: 475px");
  });

  it("shrinks the secondary panel first when both preferences exceed the viewport", () => {
    show({
      layout: { ...rightVisible, leftWidth: 900, rightWidth: 900 },
    });

    expect(
      screen.getByRole("navigation", { name: "левая панель" }).getAttribute("style"),
    ).toContain("width: 900px");
    expect(
      screen.getByRole("complementary", { name: "правая панель" }).getAttribute("style"),
    ).toContain("width: 210px");
    expect(
      screen.getByRole("separator", { name: "левая панель" }).getAttribute("aria-valuemax"),
    ).toBe("900");
    expect(
      screen.getByRole("separator", { name: "правая панель" }).getAttribute("aria-valuemax"),
    ).toBe("210");
  });
});

describe("hiding and restoring the panels", () => {
  it("a hidden left panel is gone with its edge, and a restore button takes its place", () => {
    show({ layout: { ...defaultLayout, leftHidden: true } });

    expect(screen.queryByRole("separator", { name: "левая панель" })).toBeNull();
    expect(screen.getByRole("button", { name: "показать левую" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "скрыть левую" })).toBeNull();
  });

  it("the restore button brings the panel back", () => {
    const { onLayoutChange } = show({ layout: { ...defaultLayout, leftHidden: true } });

    fireEvent.click(screen.getByRole("button", { name: "показать левую" }));

    expect(onLayoutChange).toHaveBeenLastCalledWith({ ...defaultLayout, leftHidden: false });
  });

  it("the hide button removes the panel and drops its edge", () => {
    const { onLayoutChange } = show();

    fireEvent.click(screen.getByRole("button", { name: "скрыть левую" }));

    expect(onLayoutChange).toHaveBeenLastCalledWith({ ...defaultLayout, leftHidden: true });
  });

  it("hiding the right panel also clears its open tab", () => {
    const { onLayoutChange } = show({
      layout: rightVisible,
      tabs: [{ id: "appearance", label: "Вид", content: <div>вид</div> }],
    });

    fireEvent.click(screen.getByRole("button", { name: "скрыть правую" }));

    expect(onLayoutChange).toHaveBeenLastCalledWith({
      ...rightVisible,
      rightHidden: true,
      openTab: undefined,
    });
  });

  it("the right panel is hidden by default", () => {
    show();

    expect(screen.queryByRole("separator", { name: "правая панель" })).toBeNull();
    expect(screen.getByRole("button", { name: "показать правую" })).toBeDefined();
  });

  it("restores an empty right panel with its placeholder", () => {
    const hidden = { ...defaultLayout, rightHidden: true };
    const { onLayoutChange, again } = show({ layout: hidden });

    fireEvent.click(screen.getByRole("button", { name: "показать правую" }));

    const restored = { ...hidden, rightHidden: false };
    expect(onLayoutChange).toHaveBeenLastCalledWith(restored);

    again(restored);

    expect(screen.getByRole("complementary", { name: "правая панель" })).toBeDefined();
    expect(screen.getByText("вкладок нет")).toBeDefined();
  });

  it("temporarily removes an unavailable right panel without changing its layout", () => {
    const tabs = [{ id: "appearance", label: "Вид", content: <div>содержимое вида</div> }];
    const { onLayoutChange } = show({
      layout: rightVisible,
      rightUnavailable: true,
      tabs,
    });

    expect(screen.queryByRole("complementary", { name: "правая панель" })).toBeNull();
    expect(screen.queryByRole("separator", { name: "правая панель" })).toBeNull();
    expect(screen.queryByRole("button", { name: "показать правую" })).toBeNull();
    expect(screen.queryByText("содержимое вида")).toBeNull();
    expect(onLayoutChange).not.toHaveBeenCalled();
  });

  it("restores the same right-panel content when it becomes available", () => {
    const tabs = [{ id: "appearance", label: "Вид", content: <div>содержимое вида</div> }];
    const { again } = show({
      layout: rightVisible,
      rightUnavailable: true,
      tabs,
    });

    again(rightVisible, { rightUnavailable: false });

    expect(screen.getByRole("complementary", { name: "правая панель" })).toBeDefined();
    expect(screen.getByRole("separator", { name: "правая панель" })).toBeDefined();
    expect(screen.getByText("содержимое вида")).toBeDefined();
  });
});

describe("sidebar stability across page changes", () => {
  // Регрессия фликера: при переходе между страницами сайдбар и индикатор связи не должны
  // перемонтироваться. Иначе дерево проектов сбрасывалось бы в «Loading…», а статус — в «Connecting»,
  // и каждая навигация начиналась бы с пустой панели. `navigation` и `status` стоят в фиксированных
  // позициях оболочки и не зависят от `children`, поэтому React сохраняет их subtree между рендерами.
  function NavigationProbe({ onMount }: { onMount: () => void }): React.JSX.Element {
    const mounted = useRef(false);
    if (!mounted.current) {
      mounted.current = true;
      onMount();
    }

    return <nav>сайдбар</nav>;
  }

  it("does not remount the navigation subtree when the page changes", () => {
    const mounts = vi.fn();
    const { again } = show({
      navigation: <NavigationProbe onMount={mounts} />,
      children: <div>первая страница</div>,
    });

    again(defaultLayout, { children: <div>вторая страница</div> });
    again(defaultLayout, { children: <div>третья страница</div> });

    // Один монтаж — при первом рендере; навигация пережила две смены страницы.
    expect(mounts).toHaveBeenCalledTimes(1);
  });

  it("does not remount the status subtree when the page changes", () => {
    const mounts = vi.fn();
    const StatusProbe = (): React.JSX.Element => {
      const mounted = useRef(false);
      if (!mounted.current) {
        mounted.current = true;
        mounts();
      }

      return <div role="status">статус</div>;
    };

    const { again } = show({
      status: <StatusProbe />,
      children: <div>первая страница</div>,
    });

    again(defaultLayout, { children: <div>вторая страница</div> });

    expect(mounts).toHaveBeenCalledTimes(1);
  });
});
