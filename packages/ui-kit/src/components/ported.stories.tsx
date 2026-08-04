/**
 * Истории каталога: восемь примитивов, перенесённых вперёд своего среза. Настоящий потребитель у них
 * появится в срезах 6–10 (docs/roadmap.md), и до тех пор каталог — единственное место, где их вообще
 * видно. Ради этого он и завёден.
 *
 * Проверять здесь нужно не только вид: у каждого примитива есть клавиатура, и она обязана работать без
 * мыши — Tab по полосе вкладок, стрелки внутри неё, Escape в диалоге, цикл по пунктам меню.
 */

import { useState } from "react";

import { Accordion } from "./accordion.tsx";
import { Breadcrumbs } from "./breadcrumbs.tsx";
import { Button } from "./button.tsx";
import { Combobox } from "./combobox.tsx";
import { ConfirmDialog, Dialog } from "./dialog.tsx";
import { Field } from "./field.tsx";
import { FilePicker } from "./file-picker.tsx";
import { Input, Textarea } from "./input.tsx";
import { Menu } from "./menu.tsx";
import { MultiSelect } from "./multi-select.tsx";
import { Popover } from "./popover.tsx";
import { Progress } from "./progress.tsx";
import { RadioGroup } from "./radio-group.tsx";
import { RaisedSurface } from "./raised-surface.tsx";
import { SegmentedControl } from "./segmented-control.tsx";
import { Slider } from "./slider.tsx";
import { Skeleton } from "./skeleton.tsx";
import { Tabs } from "./tabs.tsx";
import { Text } from "./text.tsx";
import { ToastProvider, useToast } from "./toast.tsx";
import { Tooltip } from "./tooltip.tsx";
import { Tree } from "./tree.tsx";

const column = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--sovereign-space-4)",
  maxWidth: "32rem",
} as const;
const row = { display: "flex", gap: "var(--sovereign-space-4)", flexWrap: "wrap" } as const;

export const Fields = () => {
  const [name, setName] = useState("");
  const [secret, setSecret] = useState("");
  const [note, setNote] = useState("");

  return (
    <div style={column}>
      <Field label="Имя проекта" hint="Показывается в списке проектов">
        {(control) => (
          <Input
            value={name}
            onChange={setName}
            placeholder="my-project"
            id={control.id}
            describedBy={control.describedBy}
            invalid={control.invalid}
          />
        )}
      </Field>
      <Field label="Пароль" error={secret.length > 0 && secret.length < 8 ? "Короче восьми" : ""}>
        {(control) => (
          <Input
            type="password"
            value={secret}
            onChange={setSecret}
            id={control.id}
            describedBy={control.describedBy}
            invalid={control.invalid}
          />
        )}
      </Field>
      <Field label="Заметка" layout="row" hint="Многострочное поле тянется вниз, а не в стороны">
        {(control) => (
          <Textarea
            value={note}
            onChange={setNote}
            rows={3}
            id={control.id}
            describedBy={control.describedBy}
            invalid={control.invalid}
          />
        )}
      </Field>
    </div>
  );
};

export const Layers = () => {
  const [dialog, setDialog] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);

  return (
    <div style={row}>
      <Button onClick={() => setDialog(true)}>Диалог</Button>
      <Button onClick={() => setDrawer(true)}>Панель сбоку</Button>
      <Button tone="danger" onClick={() => setConfirm(true)}>
        Удаление с подтверждением
      </Button>

      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="Настройки сессии"
        description="Escape закрывает, Tab не выходит за пределы слоя."
        footer={<Button onClick={() => setDialog(false)}>Закрыть</Button>}
      >
        <Text tone="muted">Содержимое диалога.</Text>
      </Dialog>

      <Dialog
        open={drawer}
        onClose={() => setDrawer(false)}
        variant="drawer"
        title="Панель сбоку"
        description="Тот же слой, другая геометрия."
      >
        <Text tone="muted">Выезжает справа и тянется во всю высоту.</Text>
      </Dialog>

      <ConfirmDialog
        open={confirm}
        onClose={() => {
          setConfirm(false);
          setPending(false);
        }}
        title="Удалить проект?"
        description="Вместе с ним пропадут 12 сессий. Отменить это нельзя."
        confirmLabel="Удалить"
        cancelLabel="Отмена"
        destructive
        pending={pending}
        onConfirm={() => setPending(true)}
      />
    </div>
  );
};

export const FilePickerStory = () => {
  const [open, setOpen] = useState(false);
  const [cwd, setCwd] = useState("/");
  const [value, setValue] = useState("");

  // Статический листинг для каталога: компонент не знает про файловую систему, ему всё равно, откуда
  // приехали записи. Дерево из двух каталогов и файла в каждом.
  const listing: Record<string, { name: string; kind: "file" | "directory" }[]> = {
    "/": [
      { name: "alpha", kind: "directory" },
      { name: "beta", kind: "directory" },
      { name: "readme.md", kind: "file" },
    ],
    "/alpha": [{ name: "notes.txt", kind: "file" }],
    "/beta": [{ name: "image.png", kind: "file" }],
  };

  return (
    <div style={row}>
      <Button onClick={() => setOpen(true)}>Открыть проводник</Button>

      <FilePicker
        open={open}
        cwd={cwd}
        value={value}
        entries={listing[cwd] ?? []}
        onNavigate={setCwd}
        onValueChange={setValue}
        onSelect={(path) => {
          setOpen(false);
          setValue(path);
        }}
        onClose={() => setOpen(false)}
        title="Выбрать папку"
        upLabel="Наверх"
        emptyLabel="Пусто"
        confirmLabel="Выбрать"
        cancelLabel="Отмена"
      />
    </div>
  );
};

export const TabsAndMenu = () => {
  const [tab, setTab] = useState("state");

  return (
    <div style={column}>
      <Tabs
        label="Разделы плагина"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "state", label: "Состояние", content: <Text>Плагин работает.</Text> },
          { id: "contributions", label: "Вклады", content: <Text>Вкладов три.</Text> },
          {
            id: "log",
            label: "Журнал",
            disabled: true,
            content: <Text>Журнал наружу не отдаётся.</Text>,
          },
        ]}
      />
      <Menu
        label="Действия над плагином"
        trigger="Действия"
        items={[
          { id: "restart", label: "Перезапустить", onSelect: () => {} },
          { id: "reveal", label: "Показать папку", onSelect: () => {} },
          { id: "forget", label: "Забыть запись", tone: "danger", onSelect: () => {} },
          { id: "disabled", label: "Недоступно", disabled: true, onSelect: () => {} },
        ]}
      />
      <div style={row}>
        <Tooltip content="Сверху">
          <Button onClick={() => {}}>Сверху</Button>
        </Tooltip>
        <Tooltip content="Справа" side="right">
          <Button onClick={() => {}}>Справа</Button>
        </Tooltip>
        <Tooltip content="Снизу" side="bottom">
          <Button onClick={() => {}}>Снизу</Button>
        </Tooltip>
      </div>
    </div>
  );
};

/**
 * Меню в самом низу панели: раскрывается вверх, чтобы список не уезжал за край окна, и занимает всю
 * ширину — так стоит кнопка в нижней части левой панели оболочки (shell.tsx).
 */
export const PanelMenu = () => (
  <div style={{ ...column, maxWidth: "16rem", paddingTop: "8rem" }}>
    <Menu
      label="Учётная запись"
      trigger="Настройки и выход"
      placement="above"
      block
      items={[
        { id: "settings", label: "Настройки", onSelect: () => {} },
        { id: "log-out", label: "Выйти", tone: "danger", onSelect: () => {} },
      ]}
    />
  </div>
);

/** Общая поднятая поверхность остаётся нейтральной к содержимому и предметной раскладке. */
export const RaisedSurfaceStory = () => (
  <div style={column}>
    <RaisedSurface>
      <Textarea
        value="Проверь изменения перед отправкой."
        onChange={() => {}}
        rows={2}
        aria-label="Сообщение агенту"
      />
    </RaisedSurface>
  </div>
);

export const Waiting = () => (
  <div style={column}>
    <Progress label="Установка зависимостей" value={0.35} />
    <Progress label="Проверка контраста" value={0.8} tone="success" />
    <Progress label="Осталось немного" value={0.15} tone="warning" />
    <Progress label="Установка идёт" />
    <Skeleton variant="text" />
    <Skeleton variant="text" width="60%" />
    <Skeleton variant="rect" height="var(--sovereign-space-12)" />
    <Skeleton variant="circle" />
  </div>
);

const selectionOptions = [
  { value: "imperium", label: "Империум" },
  { value: "nord", label: "Норд" },
  { value: "legacy", label: "Устаревшая", disabled: true },
];

export const Selectors = () => {
  const [scheme, setScheme] = useState("imperium");
  const [searchableScheme, setSearchableScheme] = useState("imperium");
  const [visibleColumns, setVisibleColumns] = useState(["imperium", "nord"]);

  return (
    <div style={column}>
      <Combobox
        label="Схема с поиском"
        options={selectionOptions}
        value={searchableScheme}
        onChange={setSearchableScheme}
        placeholder="Найдите схему"
        emptyText="Ничего не найдено"
      />
      <MultiSelect
        label="Видимые столбцы"
        options={selectionOptions}
        value={visibleColumns}
        onChange={setVisibleColumns}
        placeholder="Выберите столбцы"
      />
      <SegmentedControl
        label="Плотность списка"
        options={[
          { value: "compact", label: "Компактно" },
          { value: "comfortable", label: "Обычно" },
          { value: "spacious", label: "Свободно", disabled: true },
        ]}
        value={scheme === "imperium" ? "compact" : "comfortable"}
        onChange={(value) => setScheme(value === "compact" ? "imperium" : "nord")}
      />
      <RadioGroup
        label="Схема по умолчанию"
        options={selectionOptions}
        value={scheme}
        onChange={setScheme}
      />
    </div>
  );
};

/**
 * Дерево: выбор и раскрытие — разные жесты, и проверять здесь надо именно это. Щелчок по строке
 * выбирает узел и не сворачивает его, щелчок по раскрывашке сворачивает и не меняет выбор; с
 * клавиатуры выбирают `Enter` и пробел, раскрывают `ArrowRight` и `ArrowLeft` — то же самое.
 * Раскрытие здесь дерево помнит само: пропа `expandedIds` нет.
 */
function TreeSelection() {
  const [selectedId, setSelectedId] = useState("ui-kit");

  return (
    <div style={column}>
      <Tree
        label="Файлы демонстрации"
        selectedId={selectedId}
        onSelect={(node) => setSelectedId(node.id)}
        toggleLabel={(node, expanded) =>
          expanded ? `Свернуть ${node.label}` : `Развернуть ${node.label}`
        }
        nodes={[
          {
            id: "packages",
            label: "packages",
            badge: { tone: "neutral", text: "2" },
            actions: (
              <Button size="sm" onClick={() => {}}>
                Добавить
              </Button>
            ),
            children: [
              { id: "ui-kit", label: "ui-kit", badge: { tone: "accent", text: "изменён" } },
              { id: "protocol", label: "protocol" },
            ],
          },
          { id: "docs", label: "docs", badge: { tone: "warning", text: "разошлась" } },
        ]}
      />
      <Text tone="muted">{`Выбрано: ${selectedId}`}</Text>
    </div>
  );
}

/** Ветка, в которой разговор идёт сейчас: путь до текущего листа знает вью, а не кит. */
const currentBranchPath = ["fork", "branch-b"];

/**
 * Управляемое раскрытие: набор принадлежит вызывающему, и своего дерево не применяет вовсе. Так
 * живёт панель дерева записей сессии — она обязана открыться на работающей ветке, а не свёрнутой.
 * Проверять здесь надо, что кнопки снаружи двигают раскрытие так же, как раскрывашки внутри.
 */
function TreeCurrentBranch() {
  const [expandedIds, setExpandedIds] = useState<string[]>(currentBranchPath);
  const [selectedId, setSelectedId] = useState("reply-later");

  return (
    <div style={column}>
      <Tree
        label="Записи сессии"
        selectedId={selectedId}
        onSelect={(node) => setSelectedId(node.id)}
        expandedIds={expandedIds}
        onExpandedChange={setExpandedIds}
        toggleLabel={(node, expanded) =>
          expanded ? `Свернуть ${node.label}` : `Развернуть ${node.label}`
        }
        nodes={[
          { id: "prompt", label: "Вопрос человека" },
          { id: "reply-first", label: "Ответ агента" },
          {
            id: "fork",
            label: "Переспросили иначе",
            badge: { tone: "neutral", text: "2 ветки" },
            children: [
              {
                id: "branch-a",
                label: "Брошенная ветка",
                children: [{ id: "reply-abandoned", label: "Ответ агента" }],
              },
              {
                id: "branch-b",
                label: "Рабочая ветка",
                badge: { tone: "success", text: "текущая" },
                children: [
                  { id: "tool-call", label: "Вызов инструмента" },
                  {
                    id: "reply-later",
                    label: "Ответ агента",
                    badge: { tone: "accent", text: "лист" },
                  },
                ],
              },
            ],
          },
        ]}
      />
      <div style={row}>
        <Button onClick={() => setExpandedIds(currentBranchPath)}>Показать текущую ветку</Button>
        <Button onClick={() => setExpandedIds([])}>Свернуть всё</Button>
      </div>
    </div>
  );
}

export const NavigationAndLayers = () => {
  const [opacity, setOpacity] = useState(72);

  return (
    <div style={column}>
      <Breadcrumbs
        items={[
          { id: "projects", label: "Проекты", href: "#projects" },
          { id: "demo", label: "Демонстрация", onClick: () => {} },
          { id: "settings", label: "Настройки" },
        ]}
      />
      <Popover trigger="Открыть сведения" ariaLabel="Сведения о настройке">
        <Text>Escape или щелчок вне этого слоя закрывает его.</Text>
      </Popover>
      <Slider
        id="panel-opacity"
        label="Непрозрачность панели"
        value={opacity}
        onChange={setOpacity}
        min={20}
        max={100}
        showValue
      />
      <Accordion
        defaultExpandedIds={["effects"]}
        items={[
          {
            id: "effects",
            title: "Иерархия поверхностей",
            content: (
              <Text tone="muted">
                Семантический акцент обозначает выбор, а поднятый слой отделяют поверхность, граница
                и сдержанная тень.
              </Text>
            ),
          },
          {
            id: "scale",
            title: "Масштаб интерфейса",
            content: <Text tone="muted">Шкала меняет размеры, но не цветовую схему.</Text>,
          },
        ]}
      />
      <TreeSelection />
      <TreeCurrentBranch />
    </div>
  );
};

function ToastActions() {
  const { dismiss, toast } = useToast();
  const [persistentToastId, setPersistentToastId] = useState<string | undefined>();

  return (
    <div style={row}>
      <Button
        onClick={() => {
          toast({ title: "Настройки сохранены", tone: "success" });
        }}
      >
        Показать успех
      </Button>
      <Button
        onClick={() => {
          setPersistentToastId(
            toast({ title: "Проверка ещё идёт", tone: "warning", durationMs: 0 }),
          );
        }}
      >
        Показать постоянное
      </Button>
      <Button
        onClick={() => persistentToastId && dismiss(persistentToastId)}
        disabled={!persistentToastId}
      >
        Закрыть постоянное
      </Button>
    </div>
  );
}

export const Toasts = () => (
  <ToastProvider>
    <ToastActions />
  </ToastProvider>
);
