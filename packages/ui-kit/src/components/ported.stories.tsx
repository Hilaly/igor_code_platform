/**
 * Истории каталога: восемь примитивов, перенесённых вперёд своего среза. Настоящий потребитель у них
 * появится в срезах 6–10 (docs/roadmap.md), и до тех пор каталог — единственное место, где их вообще
 * видно. Ради этого он и завёден.
 *
 * Проверять здесь нужно не только вид: у каждого примитива есть клавиатура, и она обязана работать без
 * мыши — Tab по полосе вкладок, стрелки внутри неё, Escape в диалоге, цикл по пунктам меню.
 */

import { useState } from "react";

import { Button } from "./button.tsx";
import { ConfirmDialog, Dialog } from "./dialog.tsx";
import { Field } from "./field.tsx";
import { Input, Textarea } from "./input.tsx";
import { Menu } from "./menu.tsx";
import { Progress } from "./progress.tsx";
import { Skeleton } from "./skeleton.tsx";
import { Tabs } from "./tabs.tsx";
import { Text } from "./text.tsx";
import { Tooltip } from "./tooltip.tsx";

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
