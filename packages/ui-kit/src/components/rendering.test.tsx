/**
 * Разметка перенесённых примитивов серверной отрисовкой. Она дешевле `jsdom` и ловит другое:
 * взаимодействие так не проверить — ни фокуса, ни событий здесь нет, — но разметка первого кадра
 * проверяется полностью, и это ровно то, что глазами не видно: связь `for` с `id`, склейка
 * `aria-describedby`, отсутствие `aria-value*` в неопределённом режиме.
 *
 * Заодно ловится промах в имени класса CSS Modules: у необъявленного класса значение `undefined`, и
 * оно попадает в разметку строкой, а не отказом сборки.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ViewHeader } from "../index.ts";
import { ConfirmDialog, Dialog } from "./dialog.tsx";
import { Button } from "./button.tsx";
import { Field } from "./field.tsx";
import { FilePicker } from "./file-picker.tsx";
import { Form } from "./form.tsx";
import { Input, Textarea } from "./input.tsx";
import {
  ClearLabelIcon,
  CopyIcon,
  ForkBeforeIcon,
  ForkThroughIcon,
  SetLabelIcon,
} from "./icons.tsx";
import { Markdown } from "./markdown.tsx";
import { Menu } from "./menu.tsx";
import { Message, MessageFeed } from "./message-feed.tsx";
import { Progress } from "./progress.tsx";
import { RaisedSurface } from "./raised-surface.tsx";
import { StreamingText } from "./streaming-text.tsx";
import { Skeleton } from "./skeleton.tsx";
import { Tabs } from "./tabs.tsx";
import { Tooltip } from "./tooltip.tsx";

describe("markup of the ported primitives", () => {
  it("renders a container header with a heading and optional actions", () => {
    const markup = renderToStaticMarkup(
      <ViewHeader title="Новая сессия" level={2} actions={<button>Дерево</button>} />,
    );

    expect(markup).toContain("<header");
    expect(markup).toContain("<h2");
    expect(markup).toContain("Новая сессия");
    expect(markup).toContain("Дерево");
  });

  it("renders the shared action icons as decorative symbols on the UI-kit size grid", () => {
    const markup = renderToStaticMarkup(
      <>
        <CopyIcon size="sm" />
        <ForkBeforeIcon />
        <ForkThroughIcon />
        <SetLabelIcon />
        <ClearLabelIcon />
      </>,
    );

    expect(markup.match(/<svg/g)).toHaveLength(5);
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain("undefined");
  });

  it("raised surface preserves its content without inventing a document section", () => {
    const markup = renderToStaticMarkup(
      <RaisedSurface>
        <span>Редактируемый запрос</span>
      </RaisedSurface>,
    );

    expect(markup).not.toContain("undefined");
    expect(markup).toMatch(/^<div class="[^"]+"><span>Редактируемый запрос<\/span><\/div>$/);
  });

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

  it("form gives its semantic group the caller-provided accessible name", () => {
    // Название формы знает вызывающий: UI kit не может догадаться, это вход, создание проекта или
    // ещё одна композиция. Без имени скринридер не отличит форму от соседней.
    const markup = renderToStaticMarkup(
      <Form onSubmit={() => {}} label="Вход в Sovereign">
        <span>поле</span>
      </Form>,
    );

    expect(markup).not.toContain("undefined");
    expect(markup).toContain("поле");
    expect(markup).toContain('aria-label="Вход в Sovereign"');
  });

  it("file picker stays out of the markup without a document too", () => {
    // Пикер собран на `Dialog`, и на сервере его портал ставить некуда — первый кадр пуст. Поведение
    // то же, что у диалога, и проверяется затем же.
    expect(
      renderToStaticMarkup(
        <FilePicker
          open
          cwd="/tmp"
          value=""
          entries={[]}
          onNavigate={() => {}}
          onValueChange={() => {}}
          onSelect={() => {}}
          onClose={() => {}}
          title="Файлы"
          upLabel="Наверх"
          emptyLabel="Пусто"
          confirmLabel="Выбрать"
          cancelLabel="Отмена"
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

  it("button carries its size and icon-only classes only when asked", () => {
    // По умолчанию ни размер, ни iconOnly в классы не попадают: дефолт md — это базовая `.button`.
    const plain = renderToStaticMarkup(<Button>Действие</Button>);
    expect(plain).not.toContain("undefined");

    const icon = renderToStaticMarkup(
      <Button size="sm" iconOnly aria-label="Скрыть">
        «
      </Button>,
    );
    // Имена классов хешируются CSS Modules (`_sm_<hash>`, `_iconOnly_<hash>`), поэтому ищем модульный
    // префикс имени, а не голое слово.
    expect(icon).toMatch(/class="[^"]*_sm_[a-z0-9]+[^"]*"/);
    expect(icon).toMatch(/class="[^"]*_iconOnly_[a-z0-9]+[^"]*"/);
    expect(icon).toContain('aria-label="Скрыть"');
  });

  it("keeps ordinary buttons inert in forms and allows an explicit submit button", () => {
    const ordinary = renderToStaticMarkup(<Button>Обзор</Button>);
    const submit = renderToStaticMarkup(<Button type="submit">Создать</Button>);

    expect(ordinary).toContain('type="button"');
    expect(submit).toContain('type="submit"');
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

  it("marks a menu trigger compact when requested", () => {
    const markup = renderToStaticMarkup(
      <Menu
        label="Действия"
        trigger="…"
        triggerLabel="Действия проекта"
        compact
        items={[{ id: "rename", label: "Переименовать", onSelect: () => {} }]}
      />,
    );

    expect(markup).toMatch(/class="[^"]*trigger[^"]*compact[^"]*"/);
    expect(markup).toContain('aria-label="Действия проекта"');
  });

  it("menu that opens upward and fills its container", () => {
    const markup = renderToStaticMarkup(
      <Menu
        label="Учётная запись"
        trigger="Настройки"
        placement="above"
        block
        items={[{ id: "log-out", label: "Выйти", onSelect: () => {} }]}
      />,
    );
    expect(markup).not.toContain("undefined");
    expect(markup).toMatch(/class="[^"]*root[^"]*block[^"]*"/);
    expect(markup).toMatch(/class="[^"]*trigger[^"]*block[^"]*"/);
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

/**
 * Разметка от модели — единственное место, где в интерфейс попадает чужой текст, и проверять её
 * надо на два разных вопроса: что размётка вообще доходит до разметки и что вредное до неё не
 * доходит. Второе важнее: модель повторяет то, что прочитала в файлах проекта, а там может лежать
 * что угодно.
 */
describe("markdown from the agent", () => {
  it("renders headings, lists and emphasis", () => {
    const markup = renderToStaticMarkup(
      <Markdown text={"# Заголовок\n\nТекст с **жирным**.\n\n- первый\n- второй\n"} />,
    );

    expect(markup).not.toContain("undefined");
    expect(markup).toContain("Заголовок");
    expect(markup).toContain("<strong>жирным</strong>");
    expect(markup).toContain("<li>первый</li>");
  });

  it("shifts the top heading down, so a message cannot own the page heading", () => {
    // Заголовок страницы у оболочки один, и реплика агента не вправе стать вторым `h1`.
    const markup = renderToStaticMarkup(<Markdown text="# Заголовок" />);

    expect(markup).not.toContain("<h1");
    expect(markup).toMatch(/<h2[^>]*>Заголовок<\/h2>/);
  });

  it("renders a GFM table, which the default schema of the sanitiser is able to drop", () => {
    const markup = renderToStaticMarkup(
      <Markdown text={"| ключ | значение |\n| --- | --- |\n| a | 1 |\n"} />,
    );

    expect(markup).toContain("<table");
    expect(markup).toContain("<th");
    expect(markup).toContain("<td");
  });

  it("dresses code in the kit primitives", () => {
    const inline = renderToStaticMarkup(<Markdown text="строчный `код` внутри" />);
    expect(inline).toContain("<code");
    expect(inline).toContain("код");

    // Ограждённый блок отдаётся `CodeBlock` целиком, вместе с переводами строк внутри.
    const block = renderToStaticMarkup(<Markdown text={"```ts\nпервая\nвторая\n```\n"} />);
    expect(block).toContain("<pre");
    expect(block).toContain("первая\nвторая");
  });

  it("ignores raw HTML instead of rendering it", () => {
    const markup = renderToStaticMarkup(
      <Markdown text={"<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n"} />,
    );

    expect(markup).not.toContain("<script");
    expect(markup).not.toContain("onerror");
    expect(markup).not.toContain("<img");
  });

  it("drops a link whose scheme is not one a browser may follow safely", () => {
    const markup = renderToStaticMarkup(
      <Markdown text="[ссылка](javascript:alert(1)) и [обычная](https://example.org)" />,
    );

    expect(markup).not.toContain("javascript:");
    expect(markup).toContain('href="https://example.org"');
    // Текст ссылки остаётся: вырезана схема, а не реплика агента.
    expect(markup).toContain("ссылка");
  });

  it("opens every link in a new tab: the chat page must stay where it is", () => {
    const markup = renderToStaticMarkup(<Markdown text="[обычная](https://example.org)" />);

    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noreferrer"');
  });
});

describe("text that is still arriving", () => {
  it("says it is busy and shows a caret only while the answer is coming", () => {
    const arriving = renderToStaticMarkup(<StreamingText text="прив" streaming label="Ответ" />);
    expect(arriving).not.toContain("undefined");
    expect(arriving).toContain('aria-busy="true"');
    expect(arriving).toContain('aria-label="Ответ"');
    // Каретка — украшение и озвучиваться не должна: скринридер читает текст, а не курсор.
    expect(arriving).toContain('aria-hidden="true"');

    const finished = renderToStaticMarkup(<StreamingText text="привет" streaming={false} />);
    expect(finished).not.toContain("undefined");
    expect(finished).toContain('aria-busy="false"');
    expect(finished).not.toContain("aria-hidden");
  });

  it("keeps the line breaks the model sent", () => {
    // Разметки здесь нет вовсе, и переводы строк — единственное, чем текст структурирован.
    const markup = renderToStaticMarkup(<StreamingText text={"первая\nвторая"} streaming />);

    expect(markup).toContain("первая\nвторая");
  });
});

describe("feed of messages", () => {
  it("is a live log with a name of its own", () => {
    const markup = renderToStaticMarkup(
      <MessageFeed label="Переписка" busy>
        <Message role="human">вопрос</Message>
      </MessageFeed>,
    );

    expect(markup).not.toContain("undefined");
    expect(markup).toContain('role="log"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-label="Переписка"');
    expect(markup).toContain('aria-busy="true"');
  });

  it("marks who is speaking with data, not with a class name", () => {
    // Роль читается стилями и тестами вью; имя класса CSS Modules хешируется и цепляться за него нечем.
    const markup = renderToStaticMarkup(
      <MessageFeed label="Переписка">
        <Message role="human">вопрос</Message>
        <Message role="agent" header={<span>10:12</span>}>
          ответ
        </Message>
        <Message role="service">модель сменилась</Message>
      </MessageFeed>,
    );

    expect(markup).not.toContain("undefined");
    expect(markup).toContain('role="log"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('data-role="human"');
    expect(markup).toContain('data-role="agent"');
    expect(markup).toContain('data-role="service"');
    expect(markup).toContain("10:12");
  });
});
