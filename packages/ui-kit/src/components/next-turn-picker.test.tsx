// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type ThinkingLevel } from "@sovereign/protocol";

import { NextTurnPicker, type NextTurnPickerProps } from "./next-turn-picker.tsx";
import { Popover } from "./popover.tsx";

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
      translator={{ t: (key) => translations[key] ?? key, optional: (key) => translations[key] }}
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

  it("keeps a long model identifier readable through the ellipsized tooltip-wrapped trigger", () => {
    const longModel = "provider/" + "reasoning-capable-model-".repeat(12);

    render(
      <Harness
        model={longModel}
        modelGroups={[
          {
            id: "provider",
            label: "Provider",
            options: [{ value: longModel, label: longModel }],
          },
        ]}
      />,
    );

    const trigger = screen.getByRole("button", { name: new RegExp(longModel) });

    expect(trigger.textContent).toContain(longModel);
    expect(trigger.parentElement?.querySelector('[role="tooltip"]')?.textContent).toBe(
      "Параметры следующего турна",
    );
  });

  it("transfers focus into the model submenu, changes the controlled model, and restores trigger focus", () => {
    const onModelChange = vi.fn();
    render(<Harness model="" onModelChange={onModelChange} />);
    const trigger = screen.getByRole("button", { name: /выберите модель.*средний/i });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /Модель/ }));

    expect(document.activeElement).toBe(screen.getByRole("tree", { name: "Модель" }));
    const tree = screen.getByRole("tree", { name: "Модель" });
    fireEvent.keyDown(tree, { key: "Home" });
    fireEvent.keyDown(tree, { key: "Enter" });
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    fireEvent.keyDown(tree, { key: "Enter" });
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    fireEvent.keyDown(tree, { key: "Enter" });
    expect(onModelChange).toHaveBeenCalledWith("anthropic/claude");
    expect(document.activeElement).toBe(trigger);
  });

  it("focuses the selected reasoning option and preserves keyboard cascade behavior", () => {
    const onThinkingLevelChange = vi.fn();
    render(<Harness onThinkingLevelChange={onThinkingLevelChange} />);
    const trigger = screen.getByRole("button", { name: /anthropic\/claude.*средний/i });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /Уровень рассуждений/ }));
    const selected = screen.getByRole("option", { name: /Средний/, selected: true });

    expect(document.activeElement).toBe(selected);
    fireEvent.keyDown(selected, { key: "End" });
    const last = screen.getByRole("option", { name: "Максимальный" });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: "Home" });
    const first = screen.getByRole("option", { name: "Выкл" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "ArrowDown" });
    const next = screen.getByRole("option", { name: "Минимальный" });
    expect(document.activeElement).toBe(next);
    fireEvent.keyDown(next, { key: "Enter" });
    expect(onThinkingLevelChange).toHaveBeenCalledWith("minimal");
    expect(screen.queryByRole("menu", { name: "Параметры следующего турна" })).toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /Уровень рассуждений/ }));
    const reopened = screen.getByRole("option", { name: /Минимальный/, selected: true });
    expect(document.activeElement).toBe(reopened);
    fireEvent.keyDown(reopened, { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps the cascade open for a pointer selection in the model submenu", () => {
    const onModelChange = vi.fn();
    render(<Harness model="" onModelChange={onModelChange} />);

    fireEvent.click(screen.getByRole("button", { name: /выберите модель.*средний/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Модель/ }));
    fireEvent.click(screen.getByRole("treeitem", { name: "Anthropic" }).querySelector("div")!);

    const option = screen.getByRole("treeitem", { name: "anthropic/claude" });
    fireEvent.pointerDown(option);
    fireEvent.click(option);

    expect(onModelChange).toHaveBeenCalledWith("anthropic/claude");
    expect(screen.queryByRole("menu", { name: "Параметры следующего турна" })).toBeNull();
  });

  it("keeps the cascade open for a pointer selection in the reasoning submenu", () => {
    const onThinkingLevelChange = vi.fn();
    render(<Harness onThinkingLevelChange={onThinkingLevelChange} />);

    fireEvent.click(screen.getByRole("button", { name: /anthropic\/claude.*средний/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Уровень рассуждений/ }));

    const option = screen.getByRole("option", { name: "Высокий" });
    fireEvent.pointerDown(option);
    fireEvent.click(option);

    expect(onThinkingLevelChange).toHaveBeenCalledWith("high");
    expect(screen.queryByRole("menu", { name: "Параметры следующего турна" })).toBeNull();
  });

  it("focuses the local model tree when labels contain selector characters", () => {
    render(<Harness modelLabel={'Модель [a] "quoted"'} />);
    const trigger = screen.getByRole("button", { name: /anthropic\/claude.*средний/i });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /Модель/ }));
    expect(document.activeElement).toBe(screen.getByRole("tree"));
  });

  it("closes on an outside pointer and flips a nested submenu with the resolved left coordinate", async () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: /anthropic\/claude.*средний/i });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /Модель/ }));
    const modelRow = screen.getByRole("menuitem", { name: /Модель/ });
    vi.spyOn(modelRow, "getBoundingClientRect").mockReturnValue({
      x: 680,
      y: 0,
      width: 20,
      height: 20,
      top: 0,
      right: 700,
      bottom: 20,
      left: 680,
      toJSON: () => ({}),
    });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 700 });
    const nested = screen.getByRole("tree", { name: "Модель" }).parentElement!;
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
    await waitFor(() => {
      expect(nested.getAttribute("data-side")).toBe("left");
      expect(nested.style.position).toBe("fixed");
      expect(Number.parseFloat(nested.style.left)).toBe(612);
    });

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
    const nested = screen.getByRole("tree").parentElement!;
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
      expect(nested.style.position).toBe("fixed");
      expect(Number.parseFloat(nested.style.left)).toBeGreaterThanOrEqual(8);
      expect(Number.parseFloat(nested.style.top)).toBeLessThanOrEqual(92);
    });
  });

  it("flips a left-facing surface to the right and anchors it from the resolved side", async () => {
    render(
      <Popover side="left" viewportSafe trigger="Probe" ariaLabel="Probe">
        <div>Content</div>
      </Popover>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Probe" }));
    const trigger = screen.getByRole("button", { name: "Probe" });
    const content = screen.getByRole("dialog", { name: "Probe" });
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 20,
      width: 20,
      height: 20,
      top: 20,
      right: 20,
      bottom: 40,
      left: 0,
      toJSON: () => ({}),
    });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 100 });
    vi.spyOn(content, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 60,
      height: 20,
      top: 0,
      right: 60,
      bottom: 20,
      left: 0,
      toJSON: () => ({}),
    });
    fireEvent.resize(window);
    await waitFor(() => {
      expect(content.getAttribute("data-side")).toBe("right");
      expect(Number.parseFloat(content.style.left)).toBe(28);
    });
  });

  it("clamps oversized content to the viewport gap and keeps fixed bounds", async () => {
    render(
      <Popover side="right" viewportSafe trigger="Probe" ariaLabel="Probe">
        <div>Content</div>
      </Popover>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Probe" }));
    const trigger = screen.getByRole("button", { name: "Probe" });
    const content = screen.getByRole("dialog", { name: "Probe" });
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      x: 40,
      y: 40,
      width: 20,
      height: 20,
      top: 40,
      right: 60,
      bottom: 60,
      left: 40,
      toJSON: () => ({}),
    });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 100 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 100 });
    vi.spyOn(content, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      top: 0,
      right: 200,
      bottom: 200,
      left: 0,
      toJSON: () => ({}),
    });
    fireEvent.resize(window);
    await waitFor(() => {
      const left = Number.parseFloat(content.style.left);
      const top = Number.parseFloat(content.style.top);
      const maxWidth = Number.parseFloat(content.style.maxWidth);
      const maxHeight = Number.parseFloat(content.style.maxHeight);
      expect(content.style.position).toBe("fixed");
      expect(left).toBeGreaterThanOrEqual(8);
      expect(top).toBeGreaterThanOrEqual(8);
      expect(left + maxWidth).toBeLessThanOrEqual(92);
      expect(top + maxHeight).toBeLessThanOrEqual(92);
      expect(maxWidth).toBeLessThanOrEqual(84);
      expect(maxHeight).toBeLessThanOrEqual(84);
    });
  });

  it("flips top-facing content below when the opposite side has more room", async () => {
    render(
      <Popover side="top" viewportSafe trigger="Probe" ariaLabel="Probe">
        <div>Content</div>
      </Popover>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Probe" }));
    const trigger = screen.getByRole("button", { name: "Probe" });
    const content = screen.getByRole("dialog", { name: "Probe" });
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      x: 40,
      y: 10,
      width: 20,
      height: 10,
      top: 10,
      right: 60,
      bottom: 20,
      left: 40,
      toJSON: () => ({}),
    });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 100 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 100 });
    vi.spyOn(content, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 30,
      height: 30,
      top: 0,
      right: 30,
      bottom: 30,
      left: 0,
      toJSON: () => ({}),
    });
    fireEvent.resize(window);
    await waitFor(() => {
      expect(content.getAttribute("data-side")).toBe("bottom");
      expect(Number.parseFloat(content.style.top)).toBe(28);
    });
  });

  it("flips bottom-facing content above when the opposite side has more room", async () => {
    render(
      <Popover side="bottom" viewportSafe trigger="Probe" ariaLabel="Probe">
        <div>Content</div>
      </Popover>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Probe" }));
    const trigger = screen.getByRole("button", { name: "Probe" });
    const content = screen.getByRole("dialog", { name: "Probe" });
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      x: 40,
      y: 90,
      width: 20,
      height: 10,
      top: 90,
      right: 60,
      bottom: 100,
      left: 40,
      toJSON: () => ({}),
    });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 100 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 100 });
    vi.spyOn(content, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 30,
      height: 30,
      top: 0,
      right: 30,
      bottom: 30,
      left: 0,
      toJSON: () => ({}),
    });
    fireEvent.resize(window);
    await waitFor(() => {
      expect(content.getAttribute("data-side")).toBe("top");
      expect(Number.parseFloat(content.style.top)).toBe(52);
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

  it("preserves expanded provider groups after closing and reopening the model submenu", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: /anthropic\/claude.*средний/i });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /Модель/ }));
    fireEvent.click(screen.getByRole("treeitem", { name: "Google" }).querySelector("div")!);
    expect(screen.getByRole("treeitem", { name: "Google" }).getAttribute("aria-expanded")).toBe(
      "true",
    );

    fireEvent.click(trigger);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /Модель/ }));
    expect(screen.getByRole("treeitem", { name: "Google" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("places a nested submenu below its parent on a narrow viewport", async () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: /anthropic\/claude.*средний/i });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /Модель/ }));
    const row = screen.getByRole("menuitem", { name: /Модель/ });
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
      x: 12,
      y: 40,
      width: 180,
      height: 32,
      top: 40,
      right: 192,
      bottom: 72,
      left: 12,
      toJSON: () => ({}),
    });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 500 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
    const nested = screen.getByRole("tree", { name: "Модель" }).parentElement!;
    vi.spyOn(nested, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 300,
      height: 180,
      top: 0,
      right: 300,
      bottom: 180,
      left: 0,
      toJSON: () => ({}),
    });
    fireEvent.resize(window);
    await waitFor(() => {
      expect(nested.getAttribute("data-side")).toBe("bottom");
      expect(Number.parseFloat(nested.style.top)).toBeGreaterThanOrEqual(72);
      expect(Number.parseFloat(nested.style.left)).toBeGreaterThanOrEqual(8);
    });
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
    const trigger = screen.getByRole("button", { name: /выкл/i });
    expect(trigger.getAttribute("aria-disabled")).toBe("false");
    fireEvent.click(trigger);
    expect(
      screen.getByRole("menuitem", { name: /Уровень рассуждений/ }).getAttribute("aria-disabled"),
    ).toBe("true");
  });
});
