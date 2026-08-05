/**
 * Истории каталога: примитивы, у которых уже есть настоящий потребитель — оболочка и вью управления
 * плагинами. Здесь они собраны рядом, чтобы расхождение в отступах и скруглениях было видно глазом.
 *
 * Строки в историях — литералы, и это единственное место в ките, где так можно: каталог не поставляется
 * пользователю, а компонентам строки по-прежнему приходят пропсами уже переведёнными (docs/ui-kit.md).
 */

import { useEffect, useRef, useState } from "react";

import { Badge } from "./badge.tsx";
import { Button } from "./button.tsx";
import { Code, CodeBlock } from "./code.tsx";
import { ConfirmDialog } from "./dialog.tsx";
import { Disclosure } from "./disclosure.tsx";
import { Input } from "./input.tsx";
import { Link } from "./link.tsx";
import { List, ListRow } from "./list.tsx";
import { ModelPicker, type ModelPickerGroup } from "./model-picker.tsx";
import { Notice } from "./notice.tsx";
import { Panel } from "./panel.tsx";
import { Select } from "./select.tsx";
import { EmptyState, Spinner } from "./state.tsx";
import { StatusDot } from "./status-dot.tsx";
import { Heading, Text } from "./text.tsx";
import { Toggle } from "./toggle.tsx";
import { ToastProvider, useToast } from "./toast.tsx";
import { ViewHeader } from "./view-header.tsx";

const column = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--sovereign-space-4)",
} as const;
const row = { display: "flex", gap: "var(--sovereign-space-2)", flexWrap: "wrap" } as const;

export const Typography = () => (
  <div style={column}>
    <Heading level={1}>Заголовок первого уровня</Heading>
    <Heading level={2}>Заголовок второго уровня</Heading>
    <Heading level={3}>Заголовок третьего уровня</Heading>
    <Text>Основной текст: то, чем набрано большинство подписей интерфейса.</Text>
    <Text tone="muted">Второстепенный текст: единицы, пояснения, путь на диске.</Text>
    <Text tone="accent">Акцентный текст</Text>
    <Text tone="success">Успех</Text>
    <Text tone="warning">Предупреждение</Text>
    <Text tone="danger">Отказ</Text>
    <Text>
      Внутри строки встречается <Code>идентификатор</Code> — он набран моноширинным.
    </Text>
  </div>
);

export const Buttons = () => {
  const [pressed, setPressed] = useState(false);

  return (
    <div style={column}>
      <div style={row}>
        <Button onClick={() => {}}>Обычная</Button>
        <Button tone="accent" onClick={() => {}}>
          Основное действие
        </Button>
        <Button tone="danger" onClick={() => {}}>
          Удалить
        </Button>
        <Button onClick={() => {}} disabled>
          Недоступна
        </Button>
      </div>
      <div style={row}>
        <Button pressed={pressed} onClick={() => setPressed((on) => !on)}>
          Нажатая держит состояние
        </Button>
      </div>
    </div>
  );
};

export const Badges = () => (
  <div style={row}>
    <Badge tone="neutral">остановлен</Badge>
    <Badge tone="accent">запускается</Badge>
    <Badge tone="success">работает</Badge>
    <Badge tone="warning">с оговоркой</Badge>
    <Badge tone="danger">упал</Badge>
  </div>
);

export const Controls = () => {
  const [enabled, setEnabled] = useState(true);
  const [scheme, setScheme] = useState("imperium");

  return (
    <div style={column}>
      <Toggle checked={enabled} onChange={setEnabled} label="Плагин включён" />
      <Toggle
        checked={false}
        onChange={() => {}}
        label="Недоступен: манифест не прочитан"
        disabled
        hint="Писать предпочтения по ключу-папке некуда"
      />
      <Select
        label="Цветовая схема"
        value={scheme}
        onChange={setScheme}
        options={[
          { value: "imperium", label: "Империум" },
          { value: "nord", label: "Норд" },
        ]}
        placeholder="Выберите..."
      />
    </div>
  );
};

const pickerGroups: ModelPickerGroup[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    options: [
      {
        value: "anthropic/claude-opus",
        label: "anthropic/claude-opus",
        description: "Claude Opus",
      },
      {
        value: "anthropic/claude-sonnet",
        label: "anthropic/claude-sonnet",
        description: "Claude Sonnet",
      },
    ],
  },
  {
    id: "google",
    label: "Google",
    options: [
      { value: "google/gemini-pro", label: "google/gemini-pro", description: "Gemini Pro" },
      { value: "google/gemini-flash", label: "google/gemini-flash", description: "Gemini Flash" },
    ],
  },
];

export const ModelPickerStory = () => {
  const [value, setValue] = useState<string | undefined>(undefined);

  return (
    <div style={column}>
      <ModelPicker
        groups={pickerGroups}
        value={value}
        onChange={setValue}
        label="Модель"
        placeholder="Выберите модель"
        emptyText="Моделей нет"
      />
      <Text tone="muted">Выбрано: {value ?? "—"}</Text>
    </div>
  );
};

export const Surfaces = () => (
  <div style={column}>
    <Panel title="Панель с шапкой" actions={<Button onClick={() => {}}>Действие</Button>}>
      <Text tone="muted">Содержимое панели.</Text>
    </Panel>
    <Panel>
      <Text>Панель без шапки: у неё нет заголовка, и место под него не занято.</Text>
    </Panel>
    <List>
      <ListRow onSelect={() => {}}>Обычная строка</ListRow>
      <ListRow selected onSelect={() => {}}>
        Выбранная строка
      </ListRow>
      <ListRow>Строка, которую нельзя выбрать</ListRow>
    </List>
  </div>
);

export const ViewHeaders = () => (
  <div style={column}>
    <ViewHeader
      title="Системный журнал"
      actions={
        <div style={row}>
          <Button size="sm" onClick={() => {}}>
            Обновить
          </Button>
          <Button size="sm" onClick={() => {}}>
            Экспорт
          </Button>
          <Button size="sm" onClick={() => {}}>
            Настроить
          </Button>
        </div>
      }
    />
    <div style={{ maxWidth: "22rem" }}>
      <ViewHeader
        title="Системный журнал"
        actions={
          <div style={row}>
            <Button size="sm" onClick={() => {}}>
              Обновить
            </Button>
            <Button size="sm" onClick={() => {}}>
              Экспорт
            </Button>
            <Button size="sm" onClick={() => {}}>
              Настроить
            </Button>
          </div>
        }
      />
    </div>
  </div>
);

export const VisualFoundation = () => {
  const searchInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchInput.current?.focus();
  }, []);

  return (
    <Panel title="Appearance">
      <div style={column}>
        <Heading level={2}>Interface</Heading>
        <List>
          <ListRow selected onSelect={() => {}}>
            Imperium
          </ListRow>
          <ListRow onSelect={() => {}}>Nord</ListRow>
          <ListRow onSelect={() => {}}>
            Sage — a deliberately long appearance label for compact-row truncation
          </ListRow>
        </List>
        <Input
          ref={searchInput}
          aria-label="Search"
          value=""
          onChange={() => {}}
          placeholder="Search appearances"
        />
        <Button onClick={() => {}} disabled>
          Apply appearance
        </Button>
      </div>
    </Panel>
  );
};

export const Links = () => (
  <div style={column}>
    <Text>
      Ссылка внутри платформы ведёт на свою страницу: <Link href="/providers">провайдеры</Link>.
    </Text>
    <Text>
      Внешняя уходит новой вкладкой, потому что диалог входа продолжается на нашей:{" "}
      <Link href="https://claude.ai/oauth/authorize" external>
        войти у провайдера
      </Link>
      .
    </Text>
    <Link href="https://github.com/login/device" external>
      https://github.com/login/device
    </Link>
  </div>
);

export const Messages = () => (
  <div style={column}>
    <Notice tone="info" title="К сведению">
      Правку файла руками и запись из интерфейса различать незачем.
    </Notice>
    <Notice tone="warning" title="Работает, но не так, как задумано">
      Вклад объявлен дважды, применён вклад старшего источника.
    </Notice>
    <Notice tone="danger" title="Запись отвергнута" />
    <Disclosure summary="Схема нагрузки события">
      <CodeBlock>{`{\n  "type": "object",\n  "properties": {\n    "path": { "type": "string" }\n  }\n}`}</CodeBlock>
    </Disclosure>
  </div>
);

export const States = () => (
  <div style={column}>
    <div style={row}>
      <StatusDot tone="positive" label="Подключено" />
      <StatusDot tone="pending" label="Подключение" />
      <StatusDot tone="danger" label="Соединение потеряно" />
    </div>
    <EmptyState title="Плагинов нет" hint="Положите папку плагина в plugins/ директории данных" />
    <Spinner label="Снимок состояния запрашивается" />
  </div>
);

const statePage = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--sovereign-space-5)",
  minHeight: "32rem",
  padding: "var(--sovereign-space-5)",
  background: "var(--sovereign-page-surface)",
} as const;

export const SystemStates = () => (
  <ToastProvider>
    <SystemStateExamples />
  </ToastProvider>
);

function SystemStateExamples() {
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const { toast } = useToast();

  return (
    <div style={statePage}>
      <Heading level={1}>Системные состояния</Heading>
      <Spinner label="Состояние загружается" />
      <EmptyState title="Данных пока нет" hint="Они появятся после первого действия" />
      <Notice tone="danger" title="Состояние недоступно">
        Повтори попытку или проверь подключение.
      </Notice>
      <div style={row}>
        <Button onClick={() => setConfirmationOpen(true)}>Открыть подтверждение</Button>
        <Button
          onClick={() => toast({ title: "Изменения сохранены", tone: "success", durationMs: 0 })}
        >
          Показать уведомление
        </Button>
      </div>
      <ConfirmDialog
        open={confirmationOpen}
        onClose={() => setConfirmationOpen(false)}
        title="Подтвердить действие"
        description="Диалог остаётся отдельным слоем над поверхностью страницы."
        confirmLabel="Подтвердить"
        cancelLabel="Отмена"
        onConfirm={() => setConfirmationOpen(false)}
      />
    </div>
  );
}
