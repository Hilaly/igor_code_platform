// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button } from "./button.tsx";
import { Combobox } from "./combobox.tsx";
import { CommandList, type CommandListGroup } from "./command-list.tsx";
import { FilePicker, type FilePickerEntry } from "./file-picker.tsx";
import { Input, Textarea } from "./input.tsx";
import { SendIcon } from "./icons.tsx";
import { List, ListRow } from "./list.tsx";
import { MultiSelect } from "./multi-select.tsx";
import { Menu } from "./menu.tsx";
import { Popover } from "./popover.tsx";
import { RadioGroup } from "./radio-group.tsx";
import { SegmentedControl } from "./segmented-control.tsx";
import { Select } from "./select.tsx";
import {
  SettingsEntityRow,
  SettingsNavigationItem,
  SettingsPage,
  SettingsView,
} from "./settings-frame.tsx";
import { Slider } from "./slider.tsx";
import { SplitButton } from "./split-button.tsx";
import { StatusDot } from "./status-dot.tsx";
import { ToolCall } from "./tool-call.tsx";
import { Toggle } from "./toggle.tsx";
import { Tooltip } from "./tooltip.tsx";
import { Tree, type TreeNode } from "./tree.tsx";

const options = [
  { value: "disabled", label: "Недоступно", disabled: true },
  { value: "second", label: "Второй" },
  { value: "third", label: "Третий" },
];

/** Имя кнопки раскрытия дерева приходит от вызывающего — умолчания у него нет. */
const treeToggleLabel = (node: TreeNode, expanded: boolean) =>
  `${expanded ? "Свернуть" : "Развернуть"} ${node.label}`;

function rect(values: Partial<DOMRect> = {}): DOMRect {
  return {
    x: 0,
    y: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
    ...values,
  };
}

afterEach(cleanup);

describe("interactive components", () => {
  it.each(["normal", "secondary", "accent", "danger"] as const)(
    "keeps the %s Button tone on the native button contract",
    (tone) => {
      const onClick = vi.fn();
      render(
        <Button tone={tone} onClick={onClick} pressed={tone === "accent"}>
          Continue
        </Button>,
      );

      const button = screen.getByRole("button", { name: "Continue" });
      expect(button.getAttribute("type")).toBe("button");
      expect(button.getAttribute("aria-pressed")).toBe(tone === "accent" ? "true" : "false");
      fireEvent.click(button);
      expect(onClick).toHaveBeenCalledTimes(1);
    },
  );

  it("maps Button busy state to native disabled and aria-busy semantics", () => {
    const onClick = vi.fn();
    render(
      <Button busy onClick={onClick}>
        Save
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Save" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("keeps an icon-only Button named and permits explicit form submission", () => {
    render(
      <Button type="submit" size="sm" iconOnly aria-label="Send">
        →
      </Button>,
    );

    expect(screen.getByRole("button", { name: "Send" }).getAttribute("type")).toBe("submit");
  });

  it("forwards composite and validation state through the native Input", () => {
    render(
      <Input
        value="query"
        onChange={() => {}}
        role="combobox"
        aria-label="Search models"
        aria-autocomplete="list"
        aria-activedescendant="model-one"
        aria-controls="models"
        aria-expanded
        aria-haspopup="listbox"
        invalid
        disabled
      />,
    );

    const input = screen.getByRole("combobox", { name: "Search models" });
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(input.getAttribute("aria-activedescendant")).toBe("model-one");
    expect(input.getAttribute("aria-controls")).toBe("models");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-haspopup")).toBe("listbox");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.hasAttribute("disabled")).toBe(true);
  });

  it.each(["visible", "tooltip"] as const)(
    "names the %s-label toggle and exposes a tooltip only when requested",
    (labelDisplay) => {
      render(
        <Toggle
          checked={false}
          onChange={() => {}}
          label="Enable provider"
          labelDisplay={labelDisplay}
        />,
      );

      expect(screen.getByRole("checkbox", { name: "Enable provider" })).toBeTruthy();
      expect(document.querySelector('[role="tooltip"]') !== null).toBe(labelDisplay === "tooltip");
    },
  );

  it("reports the newly checked value when its switch is clicked", () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Enable provider" />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Enable provider" }));

    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("maps Toggle disabled state to its native checkbox", () => {
    render(<Toggle checked onChange={() => {}} label="Enable provider" disabled />);

    const toggle = screen.getByRole("checkbox", { name: "Enable provider" });
    expect(toggle.hasAttribute("disabled")).toBe(true);
  });

  it("keeps native radio grouping, checked state, and disabled choices", () => {
    const onChange = vi.fn();
    render(
      <RadioGroup
        name="delivery"
        label="Delivery"
        value="standard"
        onChange={onChange}
        options={[
          { value: "standard", label: "Standard" },
          { value: "express", label: "Express", disabled: true },
        ]}
      />,
    );

    const standard = screen.getByRole("radio", { name: "Standard" });
    const express = screen.getByRole("radio", { name: "Express" });
    expect(screen.getByRole("radiogroup", { name: "Delivery" })).toBeTruthy();
    expect(standard.getAttribute("name")).toBe("delivery");
    expect(standard.getAttribute("value")).toBe("standard");
    expect((standard as HTMLInputElement).checked).toBe(true);
    expect(express.hasAttribute("disabled")).toBe(true);
    fireEvent.click(express);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps Slider numeric bounds and optional value on a native range input", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Slider
        id="volume"
        label="Volume"
        value={25}
        min={10}
        max={90}
        step={5}
        onChange={onChange}
        showValue
      />,
    );

    const slider = screen.getByRole("slider", { name: "Volume" });
    expect(slider.getAttribute("min")).toBe("10");
    expect(slider.getAttribute("max")).toBe("90");
    expect(slider.getAttribute("step")).toBe("5");
    expect(screen.getByText("25")).toBeTruthy();
    fireEvent.change(slider, { target: { value: "35" } });
    expect(onChange).toHaveBeenCalledWith(35);

    rerender(<Slider label="Volume" value={35} onChange={onChange} disabled />);
    expect(screen.getByRole("slider", { name: "Volume" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText("35")).toBeNull();
  });

  it("connects a selectable list row to an explicitly identified tooltip", () => {
    render(
      <List>
        <ListRow onSelect={() => {}} describedBy="project-folder-tip">
          <Tooltip id="project-folder-tip" content="/complete/project/folder">
            <code>…/project/folder</code>
          </Tooltip>
        </ListRow>
      </List>,
    );

    const row = screen.getByRole("button");
    expect(row.getAttribute("aria-describedby")).toBe("project-folder-tip");
    expect(document.getElementById("project-folder-tip")?.textContent).toBe(
      "/complete/project/folder",
    );
  });

  it("keeps a disabled selectable list row semantic and inert", () => {
    const onSelect = vi.fn();

    render(
      <List>
        <ListRow onSelect={onSelect} disabled>
          Unavailable command
        </ListRow>
      </List>,
    );

    const row = screen.getByRole("button", { name: "Unavailable command" });

    expect(row.hasAttribute("disabled")).toBe(true);
    expect(row.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(row);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it.each([
    ["positive", "Daemon connected"],
    ["pending", "Daemon reconnecting"],
    ["danger", "Daemon unavailable"],
  ] as const)("names the %s status dot without exposing color as meaning", (tone, label) => {
    render(<StatusDot tone={tone} label={label} />);

    const dot = screen.getByRole("status", { name: label });
    expect(dot.getAttribute("title")).toBe(label);
  });

  it("keeps Tree actions independent from row selection", () => {
    const onSelect = vi.fn();
    render(
      <Tree
        label="Проекты"
        toggleLabel={treeToggleLabel}
        onSelect={onSelect}
        nodes={[
          {
            id: "project",
            label: "Alpha",
            actions: <button type="button">Создать сессию</button>,
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Создать сессию" }));
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByRole("button", { name: "Создать сессию" }), { key: "Enter" });
    expect(onSelect).not.toHaveBeenCalled();
    expect(
      screen
        .getByRole("treeitem", { name: "Alpha" })
        .contains(screen.getByRole("button", { name: "Создать сессию" })),
    ).toBe(false);
  });

  it("keeps a complete Tree item label available when the visible label is truncated", () => {
    const completeLabel =
      "A tree item label long enough to be truncated without losing its complete meaning";

    render(
      <Tree
        label="Проекты"
        toggleLabel={treeToggleLabel}
        nodes={[{ id: "project", label: completeLabel, title: completeLabel }]}
      />,
    );

    expect(screen.getByRole("treeitem", { name: completeLabel }).getAttribute("title")).toBe(
      completeLabel,
    );
  });

  it("keeps a Tree context open across the pointer bridge and also opens it from focus", () => {
    vi.useFakeTimers();
    try {
      render(
        <Tree
          label="Projects"
          toggleLabel={treeToggleLabel}
          actionsVisibility="interaction"
          nodes={[
            {
              id: "project",
              label: "Alpha",
              actions: <button type="button">Project actions</button>,
              context: <div>Project facts</div>,
            },
          ]}
        />,
      );

      const tree = screen.getByRole("tree", { name: "Projects" });
      expect(tree.getAttribute("data-actions-visibility")).toBe("interaction");
      const project = screen.getByRole("treeitem", { name: "Alpha" });

      fireEvent.pointerEnter(project);
      const context = screen.getByRole("tooltip", { name: "Alpha" });
      expect(context.parentElement).toBe(document.body);
      expect(screen.getByText("Project facts")).toBeTruthy();

      fireEvent.pointerLeave(project);
      fireEvent.pointerEnter(context);
      act(() => vi.advanceTimersByTime(150));
      expect(screen.getByText("Project facts")).toBeTruthy();

      fireEvent.pointerLeave(context);
      act(() => vi.advanceTimersByTime(150));
      expect(screen.queryByText("Project facts")).toBeNull();

      fireEvent.focus(project);
      expect(screen.getByText("Project facts")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clamps a Tree context to the viewport and follows the row after resize", () => {
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;

    try {
      render(
        <Tree
          label="Projects"
          toggleLabel={treeToggleLabel}
          nodes={[{ id: "project", label: "Alpha", context: <div>Project facts</div> }]}
        />,
      );

      const project = screen.getByRole("treeitem", { name: "Alpha" });
      const row = project.firstElementChild as HTMLElement;
      vi.spyOn(project, "getBoundingClientRect").mockReturnValue(rect());
      vi.spyOn(row, "getBoundingClientRect").mockReturnValue(
        rect({ left: 16, right: 316, top: 240, bottom: 280, width: 300, height: 40 }),
      );
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 600 });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: 360 });

      fireEvent.pointerEnter(project);
      const context = screen.getByRole("tooltip", { name: "Alpha" });
      vi.spyOn(context, "getBoundingClientRect").mockImplementation(() =>
        rect({ width: Number.parseFloat(context.style.width) || 384, height: 180 }),
      );
      fireEvent(window, new Event("resize"));

      expect(context.getAttribute("data-side")).toBe("right");
      expect(context.style.left).toBe("208px");
      expect(context.style.top).toBe("172px");

      Object.defineProperty(window, "innerWidth", { configurable: true, value: 900 });
      fireEvent(window, new Event("resize"));
      expect(context.getAttribute("data-side")).toBe("right");
      expect(context.style.left).toBe("324px");
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: originalHeight });
    }
  });

  it("renders a compact menu popup in the document body", () => {
    render(
      <Menu
        label="Действия"
        trigger="…"
        triggerLabel="Действия проекта"
        compact
        items={[{ id: "rename", label: "Переименовать", onSelect: () => {} }]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Действия проекта" }));

    const menu = screen.getByRole("menu", { name: "Действия" });
    expect(menu.parentElement).toBe(document.body);
  });

  it("keeps a SplitButton primary action separate from its alternatives menu", () => {
    const onAction = vi.fn();
    const onAppend = vi.fn();
    render(
      <SplitButton
        action={<SendIcon />}
        actionLabel="Send"
        onAction={onAction}
        menuLabel="Send options"
        menuTriggerLabel="Open send options"
        items={[{ id: "append", label: "Append", onSelect: onAppend }]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu", { name: "Send options" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open send options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Append" }));
    expect(onAppend).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("disables both SplitButton actions together", () => {
    const onAction = vi.fn();
    render(
      <SplitButton
        action={<SendIcon />}
        actionLabel="Send"
        onAction={onAction}
        menuLabel="Send options"
        menuTriggerLabel="Open send options"
        items={[{ id: "append", label: "Append", onSelect: () => {} }]}
        disabled
      />,
    );

    const send = screen.getByRole("button", { name: "Send" });
    const menu = screen.getByRole("button", { name: "Open send options" });
    expect(send.hasAttribute("disabled")).toBe(true);
    expect(menu.hasAttribute("disabled")).toBe(true);
    fireEvent.click(send);
    fireEvent.click(menu);
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu", { name: "Send options" })).toBeNull();
  });

  it("renders a regular menu popup in the document body", () => {
    render(
      <Menu
        label="Account"
        trigger="Account"
        items={[{ id: "settings", label: "Settings", onSelect: () => {} }]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(screen.getByRole("menu", { name: "Account" }).parentElement).toBe(document.body);
  });

  it("keeps a compact popup sized to its contents instead of the document", () => {
    render(
      <Menu
        label="Действия"
        trigger="…"
        triggerLabel="Действия проекта"
        compact
        items={[{ id: "rename", label: "Переименовать проект", onSelect: () => {} }]}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Действия проекта" });
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      x: 220,
      y: 100,
      top: 100,
      right: 244,
      bottom: 124,
      left: 220,
      width: 24,
      height: 24,
      toJSON: () => ({}),
    });
    fireEvent.click(trigger);

    const menu = screen.getByRole("menu", { name: "Действия" });
    expect(menu.style.maxWidth).toBe(`${window.innerWidth - 16}px`);
    expect(menu.style.left).toBe("220px");
  });

  it("places a hover-opened compact menu directly against its trigger", () => {
    render(
      <Menu
        label="Действия"
        trigger="…"
        triggerLabel="Действия проекта"
        compact
        openOnHover
        items={[{ id: "rename", label: "Переименовать проект", onSelect: () => {} }]}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Действия проекта" });
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      x: 220,
      y: 100,
      top: 100,
      right: 244,
      bottom: 124,
      left: 220,
      width: 24,
      height: 24,
      toJSON: () => ({}),
    });
    fireEvent.pointerEnter(trigger);

    expect(screen.getByRole("menu", { name: "Действия" }).style.top).toBe("124px");
  });

  it("keeps a hover-opened compact menu available while the pointer crosses into it", () => {
    vi.useFakeTimers();
    try {
      render(
        <Menu
          label="Project actions"
          trigger="…"
          triggerLabel="Open project actions"
          compact
          openOnHover
          items={[{ id: "rename", label: "Rename", onSelect: () => {} }]}
        />,
      );

      const trigger = screen.getByRole("button", { name: "Open project actions" });
      fireEvent.pointerEnter(trigger);
      const menu = screen.getByRole("menu", { name: "Project actions" });

      fireEvent.pointerLeave(trigger);
      fireEvent.pointerEnter(menu);
      act(() => vi.advanceTimersByTime(150));
      expect(screen.getByRole("menu", { name: "Project actions" })).toBeTruthy();

      fireEvent.pointerLeave(menu);
      act(() => vi.advanceTimersByTime(150));
      expect(screen.queryByRole("menu", { name: "Project actions" })).toBeNull();

      fireEvent.click(trigger);
      expect(screen.getByRole("menu", { name: "Project actions" })).toBeTruthy();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("menu", { name: "Project actions" })).toBeNull();
      expect(document.activeElement).toBe(trigger);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets a controlled picker render its own trigger and popup role through Popover", () => {
    const onOpenChange = vi.fn();
    render(
      <Popover
        open
        onOpenChange={onOpenChange}
        contentRole="tree"
        renderTrigger={({ contentId, open, toggle }) => (
          <button type="button" aria-controls={contentId} aria-expanded={open} onClick={toggle}>
            Модель
          </button>
        )}
      >
        <div role="treeitem">Anthropic</div>
      </Popover>,
    );

    expect(screen.getByRole("tree").parentElement).toBe(document.body);
    fireEvent.click(screen.getByRole("button", { name: "Модель" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("opens Combobox with an enabled active option and selects it from the keyboard", () => {
    const onChange = vi.fn();
    render(
      <Combobox
        options={options}
        value="missing"
        onChange={onChange}
        label="Выбор"
        placeholder="Выберите..."
        emptyText="Ничего не найдено"
      />,
    );

    const input = screen.getByRole("combobox", { name: "Выбор" });
    fireEvent.click(input);

    const enabledOption = screen.getByRole("option", { name: "Второй" });
    expect(screen.getByRole("listbox", { name: "Выбор" }).parentElement).toBe(document.body);
    expect(input.getAttribute("aria-haspopup")).toBe("listbox");
    expect(input.getAttribute("aria-activedescendant")).toBe(enabledOption.id);

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("second");
  });

  it("uses Home and End to navigate Combobox options without landing on disabled items", () => {
    const onChange = vi.fn();
    render(
      <Combobox
        options={options}
        value="second"
        onChange={onChange}
        label="Выбор"
        placeholder="Выберите..."
        emptyText="Ничего не найдено"
      />,
    );

    const input = screen.getByRole("combobox", { name: "Выбор" });
    fireEvent.click(input);
    fireEvent.keyDown(input, { key: "End" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("third");
  });

  it("resets Combobox active descendant to the enabled filtered option", () => {
    const onChange = vi.fn();
    render(
      <Combobox
        options={options}
        value="third"
        onChange={onChange}
        label="Выбор"
        placeholder="Выберите..."
        emptyText="Ничего не найдено"
      />,
    );

    const input = screen.getByRole("combobox", { name: "Выбор" });
    fireEvent.click(input);
    fireEvent.change(input, { target: { value: "Второй" } });

    const enabledOption = screen.getByRole("option", { name: "Второй" });
    expect(input.getAttribute("aria-activedescendant")).toBe(enabledOption.id);

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("second");
  });

  it("does not expose a disabled Combobox value as selected", () => {
    render(
      <Combobox
        options={options}
        value="disabled"
        onChange={() => {}}
        label="Выбор"
        placeholder="Выберите..."
        emptyText="Ничего не найдено"
      />,
    );

    const input = screen.getByRole("combobox", { name: "Выбор" }) as HTMLInputElement;
    expect(input.value).toBe("");
    fireEvent.click(input);
    expect(screen.getByRole("option", { name: "Недоступно" }).getAttribute("aria-selected")).toBe(
      "false",
    );
  });

  it("opens MultiSelect from its combobox trigger and toggles the enabled active option", () => {
    const onChange = vi.fn();
    render(
      <MultiSelect
        options={options}
        value={[]}
        onChange={onChange}
        label="Метки"
        placeholder="Выберите..."
      />,
    );

    const trigger = screen.getByRole("combobox", { name: "Метки" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    const listbox = screen.getByRole("listbox");
    expect(listbox.parentElement).toBe(document.body);
    expect(listbox.getAttribute("aria-multiselectable")).toBe("true");
    expect(trigger.getAttribute("aria-activedescendant")).toBe(
      screen.getByRole("option", { name: "Второй" }).id,
    );

    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["second"]);
  });

  it("gives each selected MultiSelect tag an accessible removal name", () => {
    render(
      <MultiSelect
        options={options}
        value={["second"]}
        onChange={() => {}}
        label="Метки"
        placeholder="Выберите..."
      />,
    );

    expect(screen.getByRole("button", { name: "Удалить Второй" })).not.toBeNull();
  });

  it("does not expose disabled MultiSelect values as selected and marks a disabled trigger", () => {
    const { rerender } = render(
      <MultiSelect
        options={options}
        value={["disabled", "second"]}
        onChange={() => {}}
        label="Метки"
        placeholder="Выберите..."
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
        placeholder="Выберите..."
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
        toggleLabel={treeToggleLabel}
        onSelect={onSelect}
        nodes={[
          { id: "parent", label: "Родитель", children: [{ id: "child", label: "Ребёнок" }] },
          { id: "sibling", label: "Сосед" },
        ]}
      />,
    );

    // Имя дерева и имя кнопки раскрытия целиком принадлежат вызывающему: своих строк у кита нет.
    expect(screen.getByRole("tree").getAttribute("aria-label")).toBe("Файлы");
    expect(screen.getByRole("button", { name: "Развернуть Родитель" })).toBeTruthy();

    const parent = screen.getByRole("treeitem", { name: "Родитель" });
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
        label="Файлы"
        toggleLabel={treeToggleLabel}
        nodes={[{ id: "parent", label: "Родитель", children: [{ id: "child", label: "Ребёнок" }] }]}
      />,
    );

    const parent = screen.getByRole("treeitem", { name: "Родитель" });
    parent.focus();
    fireEvent.keyDown(parent, { key: "ArrowRight" });

    await waitFor(() => {
      expect(screen.getByRole("treeitem", { name: "Родитель" }).getAttribute("aria-expanded")).toBe(
        "true",
      );
    });
    fireEvent.keyDown(screen.getByRole("treeitem", { name: "Родитель" }), { key: "ArrowRight" });

    expect(document.activeElement).toBe(screen.getByRole("treeitem", { name: "Ребёнок" }));
  });

  it("keeps a Tree click on the row a selection and never a collapse", () => {
    const onSelect = vi.fn();
    render(
      <Tree
        label="Записи"
        toggleLabel={treeToggleLabel}
        onSelect={onSelect}
        nodes={[
          {
            id: "turn",
            label: "Турн",
            badge: { tone: "accent", text: "черновик" },
            children: [{ id: "reply", label: "Ответ" }],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Развернуть Турн" }));

    const expandedTurn = screen.getByRole("treeitem", { name: "Турн черновик" });
    expect(expandedTurn.getAttribute("aria-expanded")).toBe("true");
    // Раскрывашка меняет только раскрытие: выбирать за человека она не имеет права.
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(expandedTurn);

    // А щелчок по строке — только выбор: раскрытую папку выбирают, не сворачивая её.
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "turn" }));
    expect(
      screen.getByRole("treeitem", { name: "Турн черновик" }).getAttribute("aria-expanded"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Свернуть Турн" }));
    expect(
      screen.getByRole("treeitem", { name: "Турн черновик" }).getAttribute("aria-expanded"),
    ).toBe("false");
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("remembers Tree expansion itself while nobody claimed it, naming every new set", () => {
    const onExpandedChange = vi.fn();
    render(
      <Tree
        label="Записи"
        toggleLabel={treeToggleLabel}
        onExpandedChange={onExpandedChange}
        nodes={[
          {
            id: "turn",
            label: "Турн",
            children: [{ id: "reply", label: "Ответ", children: [{ id: "tool", label: "Вызов" }] }],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Развернуть Турн" }));

    // Набора никто не забрал, поэтому дерево применило его само — и всё равно назвало вслух.
    expect(onExpandedChange).toHaveBeenLastCalledWith(["turn"]);
    expect(screen.getByRole("treeitem", { name: "Турн" }).getAttribute("aria-expanded")).toBe(
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Развернуть Ответ" }));
    expect(onExpandedChange).toHaveBeenLastCalledWith(["turn", "reply"]);
    expect(screen.getByRole("treeitem", { name: "Вызов" })).toBeTruthy();
  });

  it("leaves Tree expansion untouched until the caller changes expandedIds", () => {
    const onExpandedChange = vi.fn();
    const nodes: TreeNode[] = [
      {
        id: "turn",
        label: "Турн",
        children: [{ id: "reply", label: "Ответ" }],
      },
    ];
    const { rerender } = render(
      <Tree
        label="Записи"
        toggleLabel={treeToggleLabel}
        expandedIds={[]}
        onExpandedChange={onExpandedChange}
        nodes={nodes}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Развернуть Турн" }));

    // Раскрытием владеет вызывающий: сама по себе кнопка только просит о нём.
    expect(onExpandedChange).toHaveBeenCalledWith(["turn"]);
    expect(screen.getByRole("treeitem", { name: "Турн" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(screen.queryByRole("treeitem", { name: "Ответ" })).toBeNull();

    // Клавиатура в управляемом режиме означает ровно то же самое, что и мышь.
    fireEvent.keyDown(screen.getByRole("treeitem", { name: "Турн" }), { key: "ArrowRight" });
    expect(onExpandedChange).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("treeitem", { name: "Турн" }).getAttribute("aria-expanded")).toBe(
      "false",
    );

    rerender(
      <Tree
        label="Записи"
        toggleLabel={treeToggleLabel}
        expandedIds={["turn"]}
        onExpandedChange={onExpandedChange}
        nodes={nodes}
      />,
    );

    expect(screen.getByRole("treeitem", { name: "Турн" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(screen.getByRole("treeitem", { name: "Ответ" })).toBeTruthy();

    // Набор вызывающего побеждает и в обратную сторону: своего раскрытия дерево не накопило.
    fireEvent.click(screen.getByRole("button", { name: "Свернуть Турн" }));
    expect(onExpandedChange).toHaveBeenLastCalledWith([]);
    expect(screen.getByRole("treeitem", { name: "Турн" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("does not pull focus into a Tree that received its nodes while somebody was typing", () => {
    const composerLabel = "Сообщение";
    const nodes: TreeNode[] = [
      { id: "first", label: "Первый" },
      { id: "second", label: "Второй" },
    ];
    const { rerender } = render(
      <>
        <input aria-label={composerLabel} />
        <Tree label="Записи" toggleLabel={treeToggleLabel} nodes={[]} />
      </>,
    );

    const composer = screen.getByRole("textbox", { name: composerLabel });
    composer.focus();
    // Дерево записей стоит рядом с живой лентой: узлы приезжают дельтой, а не действием человека.
    rerender(
      <>
        <input aria-label={composerLabel} />
        <Tree label="Записи" toggleLabel={treeToggleLabel} nodes={nodes} />
      </>,
    );

    expect(screen.getByRole("treeitem", { name: "Первый" }).getAttribute("tabindex")).toBe("0");
    expect(document.activeElement).toBe(composer);
  });

  it("uses End to select the last enabled custom Select option", () => {
    const onChange = vi.fn();
    render(
      <Select
        options={options}
        value="second"
        onChange={onChange}
        label="Схема"
        placeholder="Выберите..."
      />,
    );

    const trigger = screen.getByRole("combobox", { name: "Схема" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "End" });
    fireEvent.keyDown(trigger, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("third");
  });

  it("closes an open Select after a pointer press outside its root", () => {
    render(
      <>
        <Select
          options={options}
          value="second"
          onChange={() => {}}
          label="Scheme"
          placeholder="Choose..."
        />
        <button type="button">Outside</button>
      </>,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Scheme" }));
    expect(screen.getByRole("listbox", { name: "Scheme" }).parentElement).toBe(document.body);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("listbox", { name: "Scheme" })).toBeNull();
  });

  it("does not expose a disabled Select value as selected and marks a disabled trigger", () => {
    const { rerender } = render(
      <Select
        options={options}
        value="disabled"
        onChange={() => {}}
        label="Схема"
        placeholder="Выберите..."
      />,
    );

    const trigger = screen.getByRole("combobox", { name: "Схема" });
    expect(trigger.textContent).toContain("Выберите...");
    fireEvent.click(trigger);
    expect(screen.getByRole("option", { name: "Недоступно" }).getAttribute("aria-selected")).toBe(
      "false",
    );

    rerender(
      <Select
        options={options}
        value="disabled"
        onChange={() => {}}
        label="Схема"
        disabled
        placeholder="Выберите..."
      />,
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
      <Select
        options={unusual}
        value={unusual[0]!.value}
        onChange={onChange}
        label="Схема"
        placeholder="Выберите..."
      />,
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
      <Combobox
        options={unusual}
        value={unusual[0]!.value}
        onChange={onChange}
        label="Выбор"
        placeholder="Выберите..."
        emptyText="Ничего не найдено"
      />,
    );
    const comboboxInput = screen.getByRole("combobox", { name: "Выбор" });
    fireEvent.click(comboboxInput);
    const comboboxOption = screen.getByRole("option");
    expect(comboboxOption.id).toMatch(/^[A-Za-z][A-Za-z0-9_-]*$/);
    expect(document.getElementById(comboboxInput.getAttribute("aria-activedescendant") ?? "")).toBe(
      comboboxOption,
    );
    unmount();

    render(
      <MultiSelect
        options={unusual}
        value={[]}
        onChange={onChange}
        label="Метки"
        placeholder="Выберите..."
      />,
    );
    const multiTrigger = screen.getByRole("combobox", { name: "Метки" });
    fireEvent.click(multiTrigger);
    const multiOption = screen.getAllByRole("option").at(-1)!;
    expect(multiOption.id).toMatch(/^[A-Za-z][A-Za-z0-9_-]*$/);
    expect(document.getElementById(multiTrigger.getAttribute("aria-activedescendant") ?? "")).toBe(
      multiOption,
    );
  });

  it("does not prevent Home or End in a closed Combobox", () => {
    render(
      <Combobox
        options={options}
        value="second"
        onChange={() => {}}
        label="Выбор"
        placeholder="Выберите..."
        emptyText="Ничего не найдено"
      />,
    );

    const input = screen.getByRole("combobox", { name: "Выбор" });
    const home = new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true });
    const end = new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true });
    expect(input.dispatchEvent(home)).toBe(true);
    expect(input.dispatchEvent(end)).toBe(true);
  });

  it("normalizes Tree roving focus without stealing it when the focused node is removed", () => {
    const composerLabel = "Сообщение";
    const { rerender } = render(
      <>
        <input aria-label={composerLabel} />
        <Tree
          label="Файлы"
          toggleLabel={treeToggleLabel}
          nodes={[
            { id: "first", label: "Первый" },
            { id: "second", label: "Второй" },
          ]}
        />
      </>,
    );

    const second = screen.getByRole("treeitem", { name: "Второй" });
    fireEvent.click(second);
    expect(document.activeElement).toBe(second);

    const composer = screen.getByRole("textbox", { name: composerLabel });
    composer.focus();
    rerender(
      <>
        <input aria-label={composerLabel} />
        <Tree
          label="Файлы"
          toggleLabel={treeToggleLabel}
          nodes={[{ id: "first", label: "Первый" }]}
        />
      </>,
    );

    // Право на `Tab` переезжает на оставшийся узел, а сам фокус остаётся там, куда его поставил
    // человек: узел исчез не по его команде.
    const first = screen.getByRole("treeitem", { name: "Первый" });
    expect(first.getAttribute("tabindex")).toBe("0");
    expect(screen.queryByRole("treeitem", { name: "Второй" })).toBeNull();
    expect(document.activeElement).toBe(composer);
  });
});

describe("tool call", () => {
  it.each([
    ["running", "Выполняется", "●"],
    ["done", "Готово", "✓"],
    ["failed", "Не удалось", "×"],
  ] as const)(
    "exposes the visible %s machine outcome with a decorative status sign",
    (status, label, signText) => {
      const { container } = render(
        <ToolCall toolName="read_file" status={status} statusLabel={label} argumentsText="{}" />,
      );

      const statusBlock = container.querySelector(`[data-status="${status}"]`);
      expect(statusBlock).not.toBeNull();
      expect(within(statusBlock as HTMLElement).getByText(label)).toBeTruthy();

      const sign = within(statusBlock as HTMLElement).getByText(signText);
      expect(sign.getAttribute("aria-hidden")).toBe("true");
      expect(sign.hasAttribute("aria-label")).toBe(false);
      expect(sign.hasAttribute("role")).toBe(false);
    },
  );

  it("keeps a complete technical summary available when its visible path is truncated", () => {
    const completeSummary =
      "apps/web/src/sessions/a-very-long-technical-directory/session-message-list.tsx";

    render(
      <ToolCall
        icon="◇"
        toolName="read_file"
        summary={completeSummary}
        duration="42 ms"
        status="done"
        statusLabel="Готово"
        argumentsText={`{"path":"${completeSummary}"}`}
      />,
    );

    const visibleSummary = screen.getByText(completeSummary);
    const disclosureControl = visibleSummary.closest("summary");

    expect(disclosureControl?.textContent).toContain(completeSummary);
    expect(visibleSummary.getAttribute("aria-label")).toBe(completeSummary);
    expect(visibleSummary.getAttribute("title")).toBe(completeSummary);
  });

  it("keeps a rich execution summary visible while the details stay folded", () => {
    render(
      <ToolCall
        icon="◇"
        toolName="read_file"
        summary="apps/web/src/App.tsx"
        duration="42 ms"
        status="done"
        statusLabel="Готово"
        argumentsText='{"path":"apps/web/src/App.tsx"}'
      />,
    );

    expect(screen.getByText("◇")).toBeTruthy();
    expect(screen.getByText("apps/web/src/App.tsx")).toBeTruthy();
    expect(screen.getByText("42 ms")).toBeTruthy();
    expect(screen.getByText("Готово")).toBeTruthy();
    expect(screen.getByText(/"path"/).closest("details")?.open).toBe(false);
  });

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

describe("settings frame", () => {
  it("opens an entity row from its target but leaves its action independent", () => {
    const onSelect = vi.fn();
    const onAction = vi.fn();

    render(
      <SettingsEntityRow
        label="Example"
        meta={<span>Running</span>}
        actions={
          <button type="button" onClick={onAction}>
            Switch
          </button>
        }
        onSelect={onSelect}
        selectLabel="Open Example"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Example" }));
    expect(onSelect).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Switch" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("shows its navigation heading inside the named settings navigation", () => {
    render(
      <SettingsView
        context="Sovereign · Settings"
        navigationLabel="SETTINGS"
        navigation={
          <SettingsNavigationItem selected onSelect={() => {}}>
            Appearance
          </SettingsNavigationItem>
        }
      >
        <SettingsPage title="Appearance">Appearance controls</SettingsPage>
      </SettingsView>,
    );

    const navigation = screen.getByRole("navigation", { name: "SETTINGS" });
    expect(within(navigation).getByText("SETTINGS")).toBeTruthy();
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(
      within(navigation).getByRole("button", { name: "Appearance" }).getAttribute("aria-current"),
    ).toBe("page");
  });
});

describe("chat composer", () => {
  it("sends on Enter and breaks the line on Shift+Enter", () => {
    const onSubmit = vi.fn();
    render(
      <Textarea value="привет" onChange={() => {}} onSubmit={onSubmit} aria-label="Сообщение" />,
    );

    const field = screen.getByRole("textbox", { name: "Сообщение" });

    const send = fireEvent.keyDown(field, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    // Отменённое событие означает, что перевод строки в поле не попал.
    expect(send).toBe(false);

    const newline = fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(newline).toBe(true);
  });

  it("keeps quiet while the input method is still composing a character", () => {
    // Enter в середине набора иероглифа подтверждает вариант, а не отправляет сообщение.
    const onSubmit = vi.fn();
    render(
      <Textarea value="привет" onChange={() => {}} onSubmit={onSubmit} aria-label="Сообщение" />,
    );

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Сообщение" }), {
      key: "Enter",
      isComposing: true,
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not send an empty message", () => {
    // Пустой турн демон примет и потратит на него обращение к модели; отсекается здесь.
    const onSubmit = vi.fn();
    render(<Textarea value="   " onChange={() => {}} onSubmit={onSubmit} aria-label="Сообщение" />);

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Сообщение" }), { key: "Enter" });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("grows with the text and stops at the row limit", () => {
    const { rerender } = render(
      <Textarea value="одна" onChange={() => {}} autoGrow maxRows={8} aria-label="Сообщение" />,
    );

    const field = screen.getByRole("textbox", { name: "Сообщение" });
    // Высоту считает браузер по `scrollHeight`; в jsdom раскладки нет, проверяется сам факт замера.
    expect(field.style.height).not.toBe("");
    expect(field.style.getPropertyValue("--textarea-max-rows")).toBe("8");

    rerender(
      <Textarea
        value={"одна\nдве\nтри"}
        onChange={() => {}}
        autoGrow
        maxRows={8}
        aria-label="Сообщение"
      />,
    );
    expect(field.style.height).not.toBe("");
  });

  describe("file picker", () => {
    /** Дерево из двух каталогов и файла в каждом; пикер получает только текущий уровень. */
    const inRoot: FilePickerEntry[] = [
      { name: "alpha", kind: "directory" },
      { name: "beta", kind: "directory" },
      { name: "readme.md", kind: "file" },
    ];
    const inAlpha: FilePickerEntry[] = [{ name: "notes.txt", kind: "file" }];

    type Cwd = string;
    const listing: Record<Cwd, FilePickerEntry[]> = {
      "/": inRoot,
      "/alpha": inAlpha,
    };

    /** Пикер с управляемым `value` иcwd; листинг выбирается по текущему каталогу. */
    function Picker(
      props: Partial<Parameters<typeof FilePicker>[0]> & { cwd: string; value: string },
    ) {
      return (
        <FilePicker
          open
          entries={listing[props.cwd] ?? []}
          onNavigate={() => {}}
          onValueChange={() => {}}
          onSelect={() => {}}
          onClose={() => {}}
          title="Файлы"
          upLabel="Наверх"
          emptyLabel="Пусто"
          confirmLabel="Выбрать"
          cancelLabel="Отмена"
          {...props}
        />
      );
    }

    it("picks a file with one click and confirm, and a folder opens on a double click", () => {
      // Два жеста не сводятся в один: одинарный клик выбирает кандидата, двойной по папке —
      // переходит. Иначе подтверждение открывало бы пикер от случайного нажатия.
      const onNavigate = vi.fn();
      const onSelect = vi.fn();
      // `value` управляется состоянием вызывающего, как и в реальном приложении: клик сообщает
      // кандидата, а перерисовка с новым `value` его подсвечивает. Здесь то же — через rerender.
      let value = "";
      const onValueChange = vi.fn((next: string) => {
        value = next;
      });
      const { rerender } = render(
        <Picker
          cwd="/"
          value={value}
          onValueChange={onValueChange}
          onNavigate={onNavigate}
          onSelect={onSelect}
        />,
      );

      // Одинарный клик по файлу делает его кандидатом; «Выбрать» подтверждает и закрывает.
      fireEvent.click(screen.getByRole("button", { name: "readme.md" }));
      expect(onValueChange).toHaveBeenCalledWith("/readme.md");
      rerender(
        <Picker
          cwd="/"
          value={value}
          onValueChange={onValueChange}
          onNavigate={onNavigate}
          onSelect={onSelect}
        />,
      );

      // Двойной клик по папке переходит в неё, не подтверждая выбор.
      fireEvent.dblClick(screen.getByRole("button", { name: "alpha" }));
      expect(onNavigate).toHaveBeenCalledWith("/alpha");

      // После клика по файлу кнопка «Выбрать» оживает — кандидат в `value`.
      expect(screen.getByRole("button", { name: "Выбрать" })).toHaveProperty("disabled", false);
      fireEvent.click(screen.getByRole("button", { name: "Выбрать" }));
      expect(onSelect).toHaveBeenCalledWith("/readme.md");

      // Переход в `/alpha` сменил листинг — пикер рисует то, что пришло в `entries`.
      rerender(
        <Picker
          cwd="/alpha"
          value={value}
          onValueChange={onValueChange}
          onNavigate={onNavigate}
          onSelect={onSelect}
        />,
      );
      expect(screen.getByRole("button", { name: "notes.txt" })).toBeDefined();
      expect(screen.queryByRole("button", { name: "alpha" })).toBeNull();
    });

    it("climbs to the parent with the «up» button and keeps it silent at the root", () => {
      const onNavigate = vi.fn();
      render(<Picker cwd="/" value="" onNavigate={onNavigate} />);

      // На корне родителя нет — кнопка «…» выключена и ничего не зовёт.
      const upAtRoot = screen.getByRole("button", { name: "Наверх" });
      expect(upAtRoot).toHaveProperty("disabled", true);
      fireEvent.click(upAtRoot);
      expect(onNavigate).not.toHaveBeenCalled();
    });
  });
});

describe("command list", () => {
  const groups: CommandListGroup[] = [
    {
      id: "work",
      label: "Работа",
      items: [
        { id: "new", label: "Новая сессия" },
        { id: "archive", label: "Архив" },
      ],
    },
    {
      id: "panels",
      label: "Панели",
      items: [
        { id: "hide", label: "Скрыть панель", disabled: true },
        { id: "show", label: "Показать панель" },
      ],
    },
  ];

  const active = (): string | undefined =>
    screen
      .queryAllByRole("option")
      .find((option) => option.getAttribute("aria-selected") === "true")?.textContent ?? undefined;

  function show(onChoose = vi.fn()) {
    render(
      <CommandList
        query=""
        onQueryChange={() => {}}
        groups={groups}
        onChoose={onChoose}
        searchLabel="Найти команду"
        emptyText="Ничего не нашлось"
      />,
    );

    return { onChoose, field: screen.getByRole("combobox", { name: "Найти команду" }) };
  }

  /**
   * Фокус остаётся в поле, а активную строку объявляет `aria-activedescendant`: иначе после каждой
   * стрелки пришлось бы возвращать фокус в поле, чтобы дописать букву.
   */
  it("keeps the focus in the field and names the active row to the screen reader", () => {
    const { field } = show();

    expect(active()).toBe("Новая сессия");
    expect(field.getAttribute("aria-activedescendant")).toMatch(/new$/);
    expect(field.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(field.getAttribute("aria-controls") ?? "")).toHaveProperty(
      "role",
      "listbox",
    );
  });

  /** Стрелки ходят по списку целиком и перешагивают недоступные строки: `Enter` заберёт активную. */
  it("walks every group with the arrows and steps over the unavailable", () => {
    const { field, onChoose } = show();

    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(active()).toBe("Архив");

    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(active()).toBe("Показать панель");

    fireEvent.keyDown(field, { key: "Enter" });
    expect(onChoose).toHaveBeenCalledWith("show");
  });

  it("wraps around and jumps to the ends", () => {
    const { field } = show();

    fireEvent.keyDown(field, { key: "ArrowUp" });
    expect(active()).toBe("Показать панель");

    fireEvent.keyDown(field, { key: "Home" });
    expect(active()).toBe("Новая сессия");

    fireEvent.keyDown(field, { key: "End" });
    expect(active()).toBe("Показать панель");
  });

  it("takes a pointer choice but not on a disabled row", () => {
    const { onChoose } = show();

    fireEvent.click(screen.getByRole("option", { name: "Скрыть панель" }));
    expect(onChoose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("option", { name: "Архив" }));
    expect(onChoose).toHaveBeenCalledWith("archive");
  });

  it("says its own words when the caller filtered everything out", () => {
    render(
      <CommandList
        query="ничего"
        onQueryChange={() => {}}
        groups={[]}
        onChoose={() => {}}
        searchLabel="Найти команду"
        emptyText="Ничего не нашлось"
      />,
    );

    expect(screen.getByText("Ничего не нашлось")).toBeDefined();
    expect(screen.queryAllByRole("option")).toEqual([]);
  });
});
