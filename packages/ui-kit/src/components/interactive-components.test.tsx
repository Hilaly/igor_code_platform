// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Combobox } from "./combobox.tsx";
import { MultiSelect } from "./multi-select.tsx";
import { SegmentedControl } from "./segmented-control.tsx";
import { Select } from "./select.tsx";
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

  it("exposes SegmentedControl as a radio group with a selected radio", () => {
    render(<SegmentedControl options={options} value="second" onChange={() => {}} label="Вид" />);

    expect(screen.getByRole("radiogroup", { name: "Вид" })).not.toBeNull();
    expect(screen.getByRole("radio", { name: "Второй" }).getAttribute("aria-checked")).toBe("true");
  });
});
