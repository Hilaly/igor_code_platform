// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
