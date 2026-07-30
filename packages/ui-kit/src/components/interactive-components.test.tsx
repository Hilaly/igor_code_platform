// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Combobox } from "./combobox.tsx";
import { MultiSelect } from "./multi-select.tsx";
import { SegmentedControl } from "./segmented-control.tsx";
import { Select } from "./select.tsx";
import { ToolCall } from "./tool-call.tsx";
import { Tree } from "./tree.tsx";

const options = [
  { value: "disabled", label: "Недоступно", disabled: true },
  { value: "second", label: "Второй" },
  { value: "third", label: "Третий" },
];

afterEach(cleanup);

describe("interactive components", () => {
  it("opens Combobox with an enabled active option and selects it from the keyboard", () => {
    const onChange = vi.fn();
    render(<Combobox options={options} value="missing" onChange={onChange} label="Выбор" />);

    const input = screen.getByRole("combobox", { name: "Выбор" });
    fireEvent.click(input);

    const enabledOption = screen.getByRole("option", { name: "Второй" });
    expect(input.getAttribute("aria-haspopup")).toBe("listbox");
    expect(input.getAttribute("aria-activedescendant")).toBe(enabledOption.id);

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("second");
  });

  it("uses Home and End to navigate Combobox options without landing on disabled items", () => {
    const onChange = vi.fn();
    render(<Combobox options={options} value="second" onChange={onChange} label="Выбор" />);

    const input = screen.getByRole("combobox", { name: "Выбор" });
    fireEvent.click(input);
    fireEvent.keyDown(input, { key: "End" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("third");
  });

  it("resets Combobox active descendant to the enabled filtered option", () => {
    const onChange = vi.fn();
    render(<Combobox options={options} value="third" onChange={onChange} label="Выбор" />);

    const input = screen.getByRole("combobox", { name: "Выбор" });
    fireEvent.click(input);
    fireEvent.change(input, { target: { value: "Второй" } });

    const enabledOption = screen.getByRole("option", { name: "Второй" });
    expect(input.getAttribute("aria-activedescendant")).toBe(enabledOption.id);

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("second");
  });

  it("does not expose a disabled Combobox value as selected", () => {
    render(<Combobox options={options} value="disabled" onChange={() => {}} label="Выбор" />);

    const input = screen.getByRole("combobox", { name: "Выбор" }) as HTMLInputElement;
    expect(input.value).toBe("");
    fireEvent.click(input);
    expect(screen.getByRole("option", { name: "Недоступно" }).getAttribute("aria-selected")).toBe(
      "false",
    );
  });

  it("opens MultiSelect from its combobox trigger and toggles the enabled active option", () => {
    const onChange = vi.fn();
    render(<MultiSelect options={options} value={[]} onChange={onChange} label="Метки" />);

    const trigger = screen.getByRole("combobox", { name: "Метки" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    const listbox = screen.getByRole("listbox");
    expect(listbox.getAttribute("aria-multiselectable")).toBe("true");
    expect(trigger.getAttribute("aria-activedescendant")).toBe(
      screen.getByRole("option", { name: "Второй" }).id,
    );

    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["second"]);
  });

  it("gives each selected MultiSelect tag an accessible removal name", () => {
    render(<MultiSelect options={options} value={["second"]} onChange={() => {}} label="Метки" />);

    expect(screen.getByRole("button", { name: "Удалить Второй" })).not.toBeNull();
  });

  it("does not expose disabled MultiSelect values as selected and marks a disabled trigger", () => {
    const { rerender } = render(
      <MultiSelect
        options={options}
        value={["disabled", "second"]}
        onChange={() => {}}
        label="Метки"
      />,
    );

    const trigger = screen.getByRole("combobox", { name: "Метки" });
    expect(screen.queryByRole("button", { name: "Удалить Недоступно" })).toBeNull();
    expect(screen.getByRole("button", { name: "Удалить Второй" })).not.toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByRole("option", { name: "Недоступно" }).getAttribute("aria-selected")).toBe(
      "false",
    );

    rerender(
      <MultiSelect
        options={options}
        value={["disabled", "second"]}
        onChange={() => {}}
        label="Метки"
        disabled
      />,
    );
    expect(screen.getByRole("combobox", { name: "Метки" }).getAttribute("aria-disabled")).toBe(
      "true",
    );
  });

  it("moves actual Tree focus between visible treeitems and selects with Space", () => {
    const onSelect = vi.fn();
    render(
      <Tree
        label="Файлы"
        onSelect={onSelect}
        nodes={[
          { id: "parent", label: "Родитель", children: [{ id: "child", label: "Ребёнок" }] },
          { id: "sibling", label: "Сосед" },
        ]}
      />,
    );

    const parent = screen.getByRole("treeitem", { name: /Родитель/ });
    parent.focus();
    fireEvent.keyDown(parent, { key: "ArrowDown" });

    const sibling = screen.getByRole("treeitem", { name: "Сосед" });
    expect(document.activeElement).toBe(sibling);

    fireEvent.keyDown(sibling, { key: " " });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "sibling" }));
  });

  it("expands a Tree item then moves real focus to its first child", async () => {
    render(
      <Tree
        nodes={[{ id: "parent", label: "Родитель", children: [{ id: "child", label: "Ребёнок" }] }]}
      />,
    );

    const parent = screen.getByRole("treeitem", { name: /Родитель/ });
    parent.focus();
    fireEvent.keyDown(parent, { key: "ArrowRight" });

    await waitFor(() => {
      expect(screen.getByRole("treeitem", { name: /Родитель/ }).getAttribute("aria-expanded")).toBe(
        "true",
      );
    });
    fireEvent.keyDown(screen.getByRole("treeitem", { name: /Родитель/ }), { key: "ArrowRight" });

    expect(document.activeElement).toBe(screen.getByRole("treeitem", { name: "Ребёнок" }));
  });

  it("uses End to select the last enabled custom Select option", () => {
    const onChange = vi.fn();
    render(<Select options={options} value="second" onChange={onChange} label="Схема" />);

    const trigger = screen.getByRole("combobox", { name: "Схема" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "End" });
    fireEvent.keyDown(trigger, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("third");
  });

  it("does not expose a disabled Select value as selected and marks a disabled trigger", () => {
    const { rerender } = render(
      <Select options={options} value="disabled" onChange={() => {}} label="Схема" />,
    );

    const trigger = screen.getByRole("combobox", { name: "Схема" });
    expect(trigger.textContent).toContain("Выберите...");
    fireEvent.click(trigger);
    expect(screen.getByRole("option", { name: "Недоступно" }).getAttribute("aria-selected")).toBe(
      "false",
    );

    rerender(
      <Select options={options} value="disabled" onChange={() => {}} label="Схема" disabled />,
    );
    expect(trigger.getAttribute("aria-disabled")).toBe("true");
  });

  it("exposes SegmentedControl as a radio group with a selected radio", () => {
    render(<SegmentedControl options={options} value="second" onChange={() => {}} label="Вид" />);

    expect(screen.getByRole("radiogroup", { name: "Вид" })).not.toBeNull();
    expect(screen.getByRole("radio", { name: "Второй" }).getAttribute("aria-checked")).toBe("true");
  });

  it("implements roving radio focus and skips disabled options", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        options={[
          { value: "first", label: "Первый" },
          { value: "second", label: "Второй", disabled: true },
          { value: "third", label: "Третий" },
        ]}
        value="first"
        onChange={onChange}
        label="Вид"
      />,
    );

    const first = screen.getByRole("radio", { name: "Первый" });
    const second = screen.getByRole("radio", { name: "Второй" });
    const third = screen.getByRole("radio", { name: "Третий" });
    expect(first.getAttribute("tabindex")).toBe("0");
    expect(second.getAttribute("tabindex")).toBe("-1");
    expect(third.getAttribute("tabindex")).toBe("-1");

    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement).toBe(third);
    expect(onChange).toHaveBeenCalledWith("third");
    fireEvent.keyDown(third, { key: "Home" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "End" });
    expect(document.activeElement).toBe(third);
  });

  it("keeps option idrefs valid when values contain whitespace and punctuation", () => {
    const unusual = [{ value: "a value/with:punc", label: "Необычный" }];
    const onChange = vi.fn();

    const { unmount } = render(
      <Select options={unusual} value={unusual[0]!.value} onChange={onChange} label="Схема" />,
    );
    const selectTrigger = screen.getByRole("combobox", { name: "Схема" });
    fireEvent.click(selectTrigger);
    const selectOption = screen.getByRole("option");
    expect(selectOption.id).toMatch(/^[A-Za-z][A-Za-z0-9_-]*$/);
    expect(document.getElementById(selectTrigger.getAttribute("aria-activedescendant") ?? "")).toBe(
      selectOption,
    );
    unmount();

    render(
      <Combobox options={unusual} value={unusual[0]!.value} onChange={onChange} label="Выбор" />,
    );
    const comboboxInput = screen.getByRole("combobox", { name: "Выбор" });
    fireEvent.click(comboboxInput);
    const comboboxOption = screen.getByRole("option");
    expect(comboboxOption.id).toMatch(/^[A-Za-z][A-Za-z0-9_-]*$/);
    expect(document.getElementById(comboboxInput.getAttribute("aria-activedescendant") ?? "")).toBe(
      comboboxOption,
    );
    unmount();

    render(<MultiSelect options={unusual} value={[]} onChange={onChange} label="Метки" />);
    const multiTrigger = screen.getByRole("combobox", { name: "Метки" });
    fireEvent.click(multiTrigger);
    const multiOption = screen.getAllByRole("option").at(-1)!;
    expect(multiOption.id).toMatch(/^[A-Za-z][A-Za-z0-9_-]*$/);
    expect(document.getElementById(multiTrigger.getAttribute("aria-activedescendant") ?? "")).toBe(
      multiOption,
    );
  });

  it("does not prevent Home or End in a closed Combobox", () => {
    render(<Combobox options={options} value="second" onChange={() => {}} label="Выбор" />);

    const input = screen.getByRole("combobox", { name: "Выбор" });
    const home = new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true });
    const end = new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true });
    expect(input.dispatchEvent(home)).toBe(true);
    expect(input.dispatchEvent(end)).toBe(true);
  });

  it("normalizes Tree roving focus when the focused node is removed", () => {
    const { rerender } = render(
      <Tree
        label="Файлы"
        nodes={[
          { id: "first", label: "Первый" },
          { id: "second", label: "Второй" },
        ]}
      />,
    );

    const second = screen.getByRole("treeitem", { name: "Второй" });
    second.focus();
    rerender(<Tree label="Файлы" nodes={[{ id: "first", label: "Первый" }]} />);

    const first = screen.getByRole("treeitem", { name: "Первый" });
    expect(first.getAttribute("tabindex")).toBe("0");
    expect(screen.queryByRole("treeitem", { name: "Второй" })).toBeNull();
  });
});

describe("tool call", () => {
  it("keeps the arguments folded until they are asked for", () => {
    render(
      <ToolCall
        toolName="write_file"
        status="running"
        statusLabel="Идёт"
        argumentsText={'{\n  "path": "hello.txt"\n}'}
      />,
    );

    const details = screen.getByText("write_file").closest("details");
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);

    fireEvent.click(screen.getByText("write_file"));
    expect(details?.open).toBe(true);
    expect(screen.getByText(/hello\.txt/)).not.toBeNull();
  });

  it("shows the outcome without unfolding anything", () => {
    // Провалившийся вызов обязан быть виден в свёрнутом состоянии: иначе про отказ узнают щелчком.
    const { container } = render(
      <ToolCall
        toolName="write_file"
        status="failed"
        statusLabel="Не удалось"
        argumentsText="{}"
      />,
    );

    expect(screen.getByText("Не удалось")).not.toBeNull();
    expect(container.querySelector('[data-status="failed"]')).not.toBeNull();
  });

  it("has no output block until the entries were read again", () => {
    // В потоке вывода инструмента нет вовсе: `tool-end` несёт только идентификатор и признак отказа.
    const { rerender, container } = render(
      <ToolCall toolName="read_file" status="done" statusLabel="Готово" argumentsText="{}" />,
    );

    expect(container.querySelectorAll("pre")).toHaveLength(1);

    rerender(
      <ToolCall
        toolName="read_file"
        status="done"
        statusLabel="Готово"
        argumentsText="{}"
        output="привет"
        outputLabel="Вывод"
      />,
    );

    expect(container.querySelectorAll("pre")).toHaveLength(2);
    expect(screen.getByText("Вывод")).not.toBeNull();
  });
});
