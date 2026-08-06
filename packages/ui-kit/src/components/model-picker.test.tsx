// @vitest-environment jsdom

/**
 * Двойной пикер на настоящем DOM. Раскрытие группы лениво зовёт подгрузку опций, выбор отдаёт
 * составную `value`, состояние группы (`loading`/`failureReason`) рисуется вместо списка, пустой
 * набор групп — заметка вместо трёх пустых. Клавиатура: раскрытие и выбор через Enter, ход стрелками.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ModelPicker,
  type ModelPickerGroup,
  ModelPickerMenu,
  type ModelPickerProps,
} from "./model-picker.tsx";

afterEach(cleanup);

const anthropic: ModelPickerGroup = {
  id: "anthropic",
  label: "Anthropic",
  options: [
    { value: "anthropic/claude-opus", label: "anthropic/claude-opus", description: "Claude Opus" },
    { value: "anthropic/claude-sonnet", label: "anthropic/claude-sonnet", description: "Sonnet" },
  ],
};

const google: ModelPickerGroup = {
  id: "google",
  label: "Google",
  options: [{ value: "google/gemini-pro", label: "google/gemini-pro", description: "Gemini Pro" }],
};

const show = (overrides: Partial<ModelPickerProps> = {}) => {
  const onChange = vi.fn();
  const onExpandGroup = vi.fn();
  const props: ModelPickerProps = {
    groups: [anthropic, google],
    value: undefined,
    onChange,
    onExpandGroup,
    label: "Модель",
    placeholder: "Выберите модель",
    emptyText: "Моделей нет",
    ...overrides,
  };

  return { ...render(<ModelPicker {...props} />), onChange, onExpandGroup, props };
};

describe("the ModelPicker", () => {
  it("keeps its existing trigger around the grouped tree", () => {
    show();

    fireEvent.click(screen.getByRole("combobox", { name: "Модель" }));

    expect(screen.getByRole("tree", { name: "Модель" })).not.toBeNull();
    expect(screen.getAllByRole("treeitem").map((item) => item.getAttribute("aria-label"))).toEqual([
      "Anthropic",
      "Google",
    ]);
  });

  it("preserves expanded groups after closing and reopening", () => {
    show();
    const trigger = screen.getByRole("combobox", { name: "Модель" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("treeitem", { name: "Anthropic" }).querySelector("div")!);
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(screen.getByRole("treeitem", { name: "Anthropic" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("renders the grouped menu body without another picker trigger", () => {
    render(
      <ModelPickerMenu
        groups={[anthropic, google]}
        value="anthropic/claude-opus"
        onChange={vi.fn()}
        onExpandGroup={vi.fn()}
        label="Модель"
        placeholder="Выберите модель"
        emptyText="Моделей нет"
      />,
    );

    expect(screen.getByRole("tree", { name: "Модель" })).not.toBeNull();
    expect(screen.queryByRole("combobox", { name: "Модель" })).toBeNull();
    expect(screen.getByRole("treeitem", { name: "Anthropic" })).not.toBeNull();
  });

  it("can open its catalogue above the trigger", () => {
    show({ side: "top" });

    fireEvent.click(screen.getByRole("combobox", { name: "Модель" }));

    expect(screen.getByRole("tree").getAttribute("data-side")).toBe("top");
  });

  it("expands a group on click and asks for its options only then", () => {
    const view = show();

    expect(view.onExpandGroup).not.toHaveBeenCalled();
    const trigger = screen.getByRole("combobox", { name: "Модель" });
    expect(trigger.tagName).toBe("BUTTON");
    fireEvent.click(trigger);

    // Шапка группы — это group с раскрывающейся подписью.
    const group = screen.getByRole("treeitem", { name: "Anthropic" });
    fireEvent.click(group.querySelector("div")!);

    expect(view.onExpandGroup).toHaveBeenCalledWith("anthropic");
    expect(view.onExpandGroup).toHaveBeenCalledTimes(1);
    expect(group.getAttribute("aria-expanded")).toBe("true");
  });

  it("lists the options of the expanded group and emits the chosen composite value", () => {
    const view = show();

    fireEvent.click(screen.getByRole("combobox", { name: "Модель" }));
    fireEvent.click(screen.getByRole("treeitem", { name: "Google" }).querySelector("div")!);

    fireEvent.click(screen.getByRole("treeitem", { name: /gemini-pro/ }));

    expect(view.onChange).toHaveBeenCalledWith("google/gemini-pro");
  });

  it("shows the spinner while a group's options are loading", () => {
    show({
      groups: [{ ...anthropic, options: [], loading: true }],
    });

    fireEvent.click(screen.getByRole("combobox", { name: "Модель" }));
    fireEvent.click(screen.getByRole("treeitem", { name: "Anthropic" }).querySelector("div")!);

    expect(screen.getByRole("status").textContent).toContain("Anthropic");
  });

  it("keeps an unloaded controlled value visible in the trigger", () => {
    show({
      groups: [{ ...anthropic, options: [], loading: true }],
      value: "anthropic/claude-opus",
    });

    expect(screen.getByRole("combobox", { name: "Модель" }).textContent).toContain(
      "anthropic/claude-opus",
    );
  });

  it("shows the failure reason instead of the list when the models could not be read", () => {
    show({
      groups: [{ ...anthropic, options: [], loading: false, failureReason: "кред недоступен" }],
    });

    fireEvent.click(screen.getByRole("combobox", { name: "Модель" }));
    fireEvent.click(screen.getByRole("treeitem", { name: "Anthropic" }).querySelector("div")!);

    expect(screen.getByText("кред недоступен")).not.toBeNull();
  });

  it("shows the empty note when there are no groups at all", () => {
    show({ groups: [] });

    fireEvent.click(screen.getByRole("combobox", { name: "Модель" }));

    expect(screen.getByText("Моделей нет")).not.toBeNull();
  });

  it("refuses to expand a disabled group and never asks for its options", () => {
    const view = show({
      groups: [{ ...anthropic, disabled: true }],
    });

    fireEvent.click(screen.getByRole("combobox", { name: "Модель" }));
    fireEvent.click(screen.getByRole("treeitem", { name: "Anthropic" }).querySelector("div")!);

    expect(view.onExpandGroup).not.toHaveBeenCalled();
    expect(screen.getByRole("treeitem", { name: "Anthropic" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("does not pick a disabled option", () => {
    const view = show({
      groups: [
        {
          id: "anthropic",
          label: "Anthropic",
          options: [
            { value: "anthropic/claude-opus", label: "opus", description: "Opus", disabled: true },
            { value: "anthropic/claude-sonnet", label: "sonnet", description: "Sonnet" },
          ],
        },
      ],
    });

    fireEvent.click(screen.getByRole("combobox", { name: "Модель" }));
    fireEvent.click(screen.getByRole("treeitem", { name: "Anthropic" }).querySelector("div")!);

    fireEvent.click(screen.getByRole("treeitem", { name: /opus/ }));

    expect(view.onChange).not.toHaveBeenCalled();
  });

  it("opens with keyboard, walks to the first group, expands and selects via Enter", () => {
    const view = show({ value: undefined });

    const trigger = screen.getByRole("combobox", { name: "Модель" });
    trigger.focus();
    // Открытие закрытого пикера.
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    // Первая строка — шапка Anthropic; Enter раскрывает её.
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(view.onExpandGroup).toHaveBeenCalledWith("anthropic");

    // Стрелка вниз — первая опция группы; Enter выбирает её.
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Enter" });

    expect(view.onChange).toHaveBeenCalledWith("anthropic/claude-opus");
  });

  it("points aria-activedescendant at the active group header", () => {
    show();

    const trigger = screen.getByRole("combobox", { name: "Модель" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    const activeId = trigger.getAttribute("aria-activedescendant");
    expect(activeId).not.toBeNull();
    expect(document.getElementById(activeId!)).not.toBeNull();
  });

  it("marks the chosen option selected in the open list", () => {
    show({ value: "anthropic/claude-opus" });

    fireEvent.click(screen.getByRole("combobox", { name: "Модель" }));

    expect(
      screen.getByRole("treeitem", { name: /claude-opus/ }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByRole("treeitem", { name: "Anthropic" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("closes on Escape without changing the selection", () => {
    const view = show({ value: "anthropic/claude-opus" });

    const trigger = screen.getByRole("combobox", { name: "Модель" });
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "Escape" });

    expect(view.onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("tree")).toBeNull();
  });

  it("does not fire onExpandGroup twice for the same group", () => {
    const view = show();

    fireEvent.click(screen.getByRole("combobox", { name: "Модель" }));
    const header = screen.getByRole("treeitem", { name: "Anthropic" }).querySelector("div")!;

    fireEvent.click(header);
    fireEvent.click(header); // Сворачивание не должно повторно просить подгрузку.

    expect(view.onExpandGroup).toHaveBeenCalledTimes(1);
  });

  it("fires onExpandGroup once per expansion under React StrictMode", () => {
    const onExpandGroup = vi.fn();
    render(
      <StrictMode>
        <ModelPicker
          groups={[anthropic]}
          value={undefined}
          onChange={vi.fn()}
          onExpandGroup={onExpandGroup}
          label="Модель"
          placeholder="Выберите модель"
          emptyText="Моделей нет"
        />
      </StrictMode>,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Модель" }));
    fireEvent.click(screen.getByRole("treeitem", { name: "Anthropic" }).querySelector("div")!);

    expect(onExpandGroup).toHaveBeenCalledTimes(1);
  });
});
