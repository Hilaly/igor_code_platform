// @vitest-environment jsdom

/**
 * Регресс на баг границ панелей: `pointermove`-слушатель внутри `onPointerDown` замыкал устаревшую
 * ширину и терял всё протаскивание, кроме последнего кадра (shell.tsx, `PanelResizer`). Тест ведёт
 * границу серией кадров и проверяет итоговую ширину — не одну лишь дельту последнего.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Shell, type ShellProps } from "./shell.tsx";
import { defaultLayout, panelWidthLimits } from "./layout.ts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(cleanup);

function show(overrides: Partial<ShellProps> = {}) {
  const onLayoutChange = vi.fn();
  const props: ShellProps = {
    layout: defaultLayout,
    onLayoutChange,
    labels: { left: "левая панель", right: "правая панель" },
    navigation: <div>навигация</div>,
    status: <div>статус демона</div>,
    tabs: [],
    children: <div>страница</div>,
    ...overrides,
  };

  render(<Shell {...props} />);

  return { onLayoutChange };
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
      layout: { ...defaultLayout, openTab: "appearance" },
      tabs: [{ id: "appearance", label: "Вид", content: <div>вид</div> }],
    });
    const separator = screen.getByRole("separator", { name: "правая панель" });

    drag(separator, 500, [480, 460]);

    expect(onLayoutChange).toHaveBeenLastCalledWith({
      ...defaultLayout,
      openTab: "appearance",
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

  it("announces its range for a screen reader", () => {
    show();
    const left = screen.getByRole("separator", { name: "левая панель" });

    expect(left.getAttribute("aria-valuemin")).toBe(String(panelWidthLimits.minimum));
    expect(left.getAttribute("aria-valuemax")).toBe(String(panelWidthLimits.maximum));
    expect(left.getAttribute("aria-valuenow")).toBe(String(defaultLayout.leftWidth));
  });
});
