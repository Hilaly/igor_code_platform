// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Combobox } from "./combobox.tsx";
import { FilePicker, type FilePickerEntry } from "./file-picker.tsx";
import { Textarea } from "./input.tsx";
import { MultiSelect } from "./multi-select.tsx";
import { SegmentedControl } from "./segmented-control.tsx";
import { Select } from "./select.tsx";
import { ToolCall } from "./tool-call.tsx";
import { Tree, type TreeNode } from "./tree.tsx";

const options = [
  { value: "disabled", label: "Недоступно", disabled: true },
  { value: "second", label: "Второй" },
  { value: "third", label: "Третий" },
];

/** Имя кнопки раскрытия дерева приходит от вызывающего — умолчания у него нет. */
const treeToggleLabel = (node: TreeNode, expanded: boolean) =>
  `${expanded ? "Свернуть" : "Развернуть"} ${node.label}`;

afterEach(cleanup);

describe("interactive components", () => {
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
