/**
 * Разметка перенесённых примитивов: серверная отрисовка вместо DOM-стека, которого в проекте нет
 * (docs/backlog.md). Взаимодействие так не проверить — ни фокуса, ни событий здесь нет, — но разметка
 * первого кадра проверяется полностью, и это ровно то, что глазами не видно: связь `for` с `id`,
 * склейка `aria-describedby`, отсутствие `aria-value*` в неопределённом режиме.
 *
 * Заодно ловится промах в имени класса CSS Modules: у необъявленного класса значение `undefined`, и
 * оно попадает в разметку строкой, а не отказом сборки.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConfirmDialog, Dialog } from "./dialog.tsx";
import { Button } from "./button.tsx";
import { Field } from "./field.tsx";
import { Input, Textarea } from "./input.tsx";
import { Menu } from "./menu.tsx";
import { Progress } from "./progress.tsx";
import { Skeleton } from "./skeleton.tsx";
import { Tabs } from "./tabs.tsx";
import { Tooltip } from "./tooltip.tsx";

describe("markup of the ported primitives", () => {
  it("input", () => {
    const markup = renderToStaticMarkup(
      <Input value="a" onChange={() => {}} invalid id="x" describedBy="y" type="search" />,
    );
    expect(markup).not.toContain("undefined");
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('aria-describedby="y"');
    expect(markup).toContain('type="search"');
  });

  it("tells the password manager what the input is for", () => {
    // Без `autocomplete` менеджер паролей не понимает, что предложить, а форма входа — это ровно то
    // место, где он обязан работать: пароль в этой платформе один и вводится редко.
    const markup = renderToStaticMarkup(
      <Input value="a" onChange={() => {}} type="password" autoComplete="current-password" />,
    );

    // Регистр имени не проверяется: React 19 пишет проп как есть, а имена атрибутов в HTML
    // регистронезависимы — браузер видит `autocomplete` в любом случае.
    expect(markup).toMatch(/autocomplete="current-password"/i);
    expect(markup).not.toContain("undefined");
  });

  it("leaves the autocomplete out when it was not asked for", () => {
    const markup = renderToStaticMarkup(<Input value="a" onChange={() => {}} />);

    expect(markup).not.toMatch(/autocomplete/i);
  });

  it("forwards composite accessibility props from input", () => {
    const markup = renderToStaticMarkup(
      <Input
        value="a"
        onChange={() => {}}
        role="combobox"
        aria-label="Поиск"
        aria-autocomplete="list"
        aria-activedescendant="option-1"
        aria-controls="results"
        aria-expanded
        aria-haspopup="listbox"
      />,
    );

    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('aria-label="Поиск"');
    expect(markup).toContain('aria-autocomplete="list"');
    expect(markup).toContain('aria-activedescendant="option-1"');
    expect(markup).toContain('aria-controls="results"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('aria-haspopup="listbox"');
  });

  it("textarea", () => {
    const markup = renderToStaticMarkup(<Textarea value="a" onChange={() => {}} rows={4} />);
    expect(markup).not.toContain("undefined");
    expect(markup).toContain('rows="4"');
  });

  it("field", () => {
    const markup = renderToStaticMarkup(
      <Field label="Имя" hint="подсказка" error="ошибка" describedBy="outer">
        {(control) => (
          <Input
            value=""
            onChange={() => {}}
            id={control.id}
            describedBy={control.describedBy}
            invalid={control.invalid}
          />
        )}
      </Field>,
    );
    expect(markup).not.toContain("undefined");
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toMatch(/aria-describedby="outer [^"]*-hint [^"]*-error"/);
    expect(markup).toMatch(/for="([^"]+)"[\s\S]*id="\1"/);
  });

  /**
   * Вызывающий пишет `error={broken ? "текст" : ""}` — так написана и история каталога. Пустая строка
   * обязана значить «ошибки нет»: иначе пустая форма открывается уже красной, а `aria-describedby`
   * ведёт на пустой элемент.
   */
  it("field treats an empty error as no error at all", () => {
    const markup = renderToStaticMarkup(
      <Field label="Имя" error="">
        {(control) => (
          <Input
            value=""
            onChange={() => {}}
            id={control.id}
            describedBy={control.describedBy}
            invalid={control.invalid}
          />
        )}
      </Field>,
    );
    expect(markup).not.toContain("undefined");
    expect(markup).not.toContain('aria-invalid="true"');
    expect(markup).not.toContain("aria-describedby");
  });

  it("dialog stays out of the markup without a document", () => {
    expect(renderToStaticMarkup(<Dialog open onClose={() => {}} title="Т" />)).toBe("");
    expect(
      renderToStaticMarkup(
        <ConfirmDialog
          open
          onClose={() => {}}
          onConfirm={() => {}}
          title="Т"
          confirmLabel="Да"
          cancelLabel="Нет"
          pending
        />,
      ),
    ).toBe("");
  });

  it("tabs", () => {
    const markup = renderToStaticMarkup(
      <Tabs
        label="Разделы"
        value="second"
        onChange={() => {}}
        tabs={[
          { id: "first", label: "Первый", content: "первое" },
          { id: "second", label: "Второй", content: "второе" },
          { id: "third", label: "Третий", disabled: true, content: "третье" },
        ]}
      />,
    );
    expect(markup).not.toContain("undefined");
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-label="Разделы"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain("второе");
    expect(markup).not.toContain("первое");
    expect(markup).toMatch(/aria-controls="([^"]+)"[\s\S]*id="\1"/);
  });

  it("tooltip", () => {
    const markup = renderToStaticMarkup(
      <Tooltip content="почему" side="left">
        <button type="button">кнопка</button>
      </Tooltip>,
    );
    expect(markup).not.toContain("undefined");
    expect(markup).toContain('role="tooltip"');
  });

  it("connects a tooltip to a UI-kit Button and preserves its description", () => {
    const markup = renderToStaticMarkup(
      <Tooltip content="почему">
        <Button aria-describedby="field-hint">кнопка</Button>
      </Tooltip>,
    );

    const tooltipId = markup.match(/id="([^"]+)" role="tooltip"/)?.[1];
    expect(tooltipId).toBeDefined();
    expect(markup).toContain(`aria-describedby="field-hint ${tooltipId}"`);
  });

  it("menu", () => {
    const markup = renderToStaticMarkup(
      <Menu
        label="Действия"
        trigger="Ещё"
        items={[{ id: "remove", label: "Удалить", tone: "danger", onSelect: () => {} }]}
      />,
    );
    expect(markup).not.toContain("undefined");
    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain('role="menu"');
  });

  it("progress", () => {
    const determinate = renderToStaticMarkup(<Progress value={0.423} label="Загрузка" />);
    expect(determinate).not.toContain("undefined");
    expect(determinate).toContain('aria-valuenow="42"');
    expect(determinate).toContain("--progress:42%");

    const indeterminate = renderToStaticMarkup(<Progress label="Загрузка" tone="warning" />);
    expect(indeterminate).not.toContain("undefined");
    expect(indeterminate).not.toContain("aria-valuenow");
  });

  it("skeleton", () => {
    const markup = renderToStaticMarkup(<Skeleton variant="circle" width="2rem" />);
    expect(markup).not.toContain("undefined");
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("width:2rem");
  });
});
