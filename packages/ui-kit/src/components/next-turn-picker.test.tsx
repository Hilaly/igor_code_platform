// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type ThinkingLevel } from "@sovereign/protocol";

import { NextTurnPicker, type NextTurnPickerProps } from "./next-turn-picker.tsx";

afterEach(cleanup);

const modelGroups: NextTurnPickerProps["modelGroups"] = [
  {
    id: "anthropic",
    label: "Anthropic",
    options: [{ value: "anthropic/claude", label: "anthropic/claude" }],
  },
  {
    id: "google",
    label: "Google",
    options: [{ value: "google/gemini", label: "google/gemini" }],
  },
];

const translations: Record<string, string> = {
  "thinking.off": "Выкл",
  "thinking.minimal": "Минимальный",
  "thinking.low": "Низкий",
  "thinking.medium": "Средний",
  "thinking.high": "Высокий",
  "thinking.xhigh": "Очень высокий",
  "thinking.max": "Максимальный",
};

type HarnessProps = Partial<NextTurnPickerProps>;

function Harness({
  model: initialModel = "anthropic/claude",
  thinkingLevel: initialThinkingLevel = "medium",
  onModelChange,
  onThinkingLevelChange,
  ...overrides
}: HarnessProps): React.JSX.Element {
  const [model, setModel] = useState(initialModel);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(initialThinkingLevel);

  return (
    <NextTurnPicker
      model={model}
      modelGroups={modelGroups}
      onModelChange={(nextModel) => {
        setModel(nextModel);
        onModelChange?.(nextModel);
      }}
      onExpandModelGroup={vi.fn()}
      thinkingLevel={thinkingLevel}
      reasoningSupported
      onThinkingLevelChange={(nextLevel) => {
        setThinkingLevel(nextLevel);
        onThinkingLevelChange?.(nextLevel);
      }}
      modelLabel="Модель"
      reasoningLabel="Уровень рассуждений"
      triggerLabel="Параметры следующего турна"
      placeholder="Выберите модель"
      emptyText="Моделей нет"
      translator={{ t: (key) => translations[key] ?? key }}
      {...overrides}
    />
  );
}

describe("the NextTurnPicker", () => {
  it("opens one first-level menu with model and reasoning rows", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /anthropic\/claude.*средний/i }));
    expect(screen.getByRole("menu", { name: "Параметры следующего турна" })).not.toBeNull();
    expect(screen.getByRole("menuitem", { name: /Модель/ })).not.toBeNull();
    expect(screen.getByRole("menuitem", { name: /Уровень рассуждений/ })).not.toBeNull();
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
  });

  it("transfers focus into the model submenu, changes the controlled model, and restores trigger focus", () => {
    const onModelChange = vi.fn();
    render(<Harness onModelChange={onModelChange} />);
    const trigger = screen.getByRole("button", { name: /anthropic\/claude.*средний/i });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /Модель/ }));

    expect(document.activeElement).toBe(screen.getByRole("tree", { name: "Модель" }).parentElement);
    fireEvent.click(screen.getByRole("treeitem", { name: "Google" }).querySelector("div")!);
    fireEvent.click(screen.getByRole("treeitem", { name: /gemini/ }));

    expect(onModelChange).toHaveBeenCalledWith("google/gemini");
    expect(document.activeElement).toBe(trigger);
  });

  it("navigates reasoning options with arrows and restores focus after Escape", () => {
    const onThinkingLevelChange = vi.fn();
    render(<Harness onThinkingLevelChange={onThinkingLevelChange} />);
    const trigger = screen.getByRole("button", { name: /anthropic\/claude.*средний/i });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /Уровень рассуждений/ }));
    const listbox = screen.getByRole("listbox", { name: "Уровень рассуждений" });

    expect(document.activeElement).toBe(listbox);
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    fireEvent.keyDown(listbox, { key: "Enter" });
    expect(onThinkingLevelChange).toHaveBeenCalledWith("minimal");
    expect(screen.queryByRole("menu", { name: "Параметры следующего турна" })).toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /Уровень рассуждений/ }));
    fireEvent.keyDown(screen.getByRole("listbox", { name: "Уровень рассуждений" }), {
      key: "Escape",
    });
    expect(document.activeElement).toBe(trigger);
  });

  it("focuses the local model tree when labels contain selector characters", () => {
    render(<Harness modelLabel={'Модель [a] "quoted"'} />);
    const trigger = screen.getByRole("button", { name: /anthropic\/claude.*средний/i });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /Модель/ }));
    expect(document.activeElement).toBe(screen.getByRole("tree").parentElement);
  });

  it("closes on an outside pointer and flips a nested submenu when the right side overflows", async () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: /anthropic\/claude.*средний/i });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /Модель/ }));
    const modelRow = screen.getByRole("menuitem", { name: /Модель/ });
    const rowRoot = modelRow.parentElement!;
    vi.spyOn(modelRow, "getBoundingClientRect").mockReturnValue({
      x: 80,
      y: 0,
      width: 20,
      height: 20,
      top: 0,
      right: 100,
      bottom: 20,
      left: 80,
      toJSON: () => ({}),
    });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 100 });
    const nested = screen.getByRole("tree", { name: "Модель" }).parentElement!.parentElement!;
    vi.spyOn(nested, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 60,
      height: 100,
      top: 0,
      right: 60,
      bottom: 100,
      left: 0,
      toJSON: () => ({}),
    });
    fireEvent.resize(window);
    await waitFor(() => expect(nested.getAttribute("data-side")).toBe("left"));

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu", { name: "Параметры следующего турна" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("clamps nested content when both horizontal sides and the vertical boundary are constrained", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /anthropic\/claude.*средний/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Модель/ }));
    const row = screen.getByRole("menuitem", { name: /Модель/ });
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
      x: 45,
      y: 90,
      width: 10,
      height: 10,
      top: 90,
      right: 55,
      bottom: 100,
      left: 45,
      toJSON: () => ({}),
    });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 100 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 100 });
    const nested = screen.getByRole("tree").parentElement!.parentElement!;
    vi.spyOn(nested, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 80,
      height: 80,
      top: 0,
      right: 80,
      bottom: 80,
      left: 0,
      toJSON: () => ({}),
    });
    fireEvent.resize(window);
    await waitFor(() => {
      expect(nested.getAttribute("data-side")).toBe("right");
    });
  });

  it("opens provider-grouped model submenu and preserves lazy expansion callback", () => {
    const onExpand = vi.fn();
    render(<Harness onExpandModelGroup={onExpand} />);
    fireEvent.click(screen.getByRole("button", { name: /anthropic\/claude.*средний/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Модель/ }));
    expect(screen.getByRole("tree", { name: "Модель" })).not.toBeNull();
    fireEvent.click(screen.getByRole("treeitem", { name: "Google" }).querySelector("div")!);
    expect(onExpand).toHaveBeenCalledWith("google");
  });

  it("opens reasoning submenu, changes level, and closes the cascade", () => {
    const onChange = vi.fn();
    render(<Harness onThinkingLevelChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /anthropic\/claude.*средний/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Уровень рассуждений/ }));
    fireEvent.click(screen.getByRole("option", { name: "Высокий" }));
    expect(onChange).toHaveBeenCalledWith("high");
    expect(screen.queryByRole("menu", { name: "Параметры следующего турна" })).toBeNull();
  });

  it("forces off and disables reasoning when the selected model does not support it", () => {
    render(<Harness reasoningSupported={false} thinkingLevel="high" />);
    expect(screen.getByRole("button", { name: /выкл/i }).getAttribute("aria-disabled")).toBe(
      "true",
    );
  });
});
