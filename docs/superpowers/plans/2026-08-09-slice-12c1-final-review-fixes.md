# Slice 12c-1 Final Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Исправить четыре оставшихся дефекта команд и палитры среза 12c-1 и подготовить feature-ветку
к слиянию.

**Architecture:** `App` передаёт одинаковое вычисленное состояние недоступности правой панели и
оболочке, и командам ядра. Палитра принимает только точный глобальный аккорд, а UI kit выражает
недоступную выбираемую строку нативной выключенной кнопкой.

**Tech Stack:** TypeScript 5.9, React 19, Vitest 3, Testing Library, CSS Modules, pnpm workspaces,
Make.

## Global Constraints

- Не добавлять новых команд, маршрутов, вкладов или зависимостей.
- Команды правой панели остаются видимыми, но недоступными на всех Settings-маршрутах.
- Левая панель не зависит от доступности правой.
- Палитра принимает только `Meta+K` либо `Ctrl+K`, без `Shift`, `Alt` и второго platform modifier.
- `ListRow disabled` сохраняет нативную button-семантику и геометрию выбираемой строки.
- Каждый продуктовый дефект сначала получает падающий тест.
- Web-проверки в текущем окружении запускаются с `NODE_OPTIONS=--no-experimental-webstorage`.
- Push и PR не выполнять.

---

### Task 1: Доступность команд правой панели

**Files:**

- Modify: `apps/web/src/commands/core-commands.test.ts`
- Modify: `apps/web/src/commands/core-commands.ts`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**

- Consumes: `Shell.rightUnavailable` и текущие variants `Page`.
- Produces: `CoreCommandHost.rightUnavailable: boolean`; одинаковое значение у `Shell` и
  `CommandPalette.host`.

- [x] **Step 1: Write the failing test**

Расширить test helper параметром `rightUnavailable = false` и добавить проверку, которая ловит
отсутствующую проверку этого состояния:

```ts
it("switches off both right-panel commands while the panel is unavailable", () => {
  const shell = host(defaultLayout, true);

  expect(command("core.panel.right.show").available?.(shell)).toBe(false);
  expect(command("core.panel.right.hide").available?.(shell)).toBe(false);
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @sovereign/web test -- src/commands/core-commands.test.ts
```

Expected: FAIL because `core.panel.right.hide` still returns `true` for visible layout.

- [x] **Step 3: Write minimal implementation**

Добавить обязательный host-признак и включить его в обе проверки:

```ts
export type CoreCommandHost = {
  navigate: (page: Page) => void;
  layout: ShellLayout;
  rightUnavailable: boolean;
  onLayoutChange: (layout: ShellLayout) => void;
};

available: (host) => !host.rightUnavailable && host.layout.rightHidden;
available: (host) => !host.rightUnavailable && !host.layout.rightHidden;
```

В `App` один раз вычислить:

```ts
const rightUnavailable =
  page.kind === "settings" || page.kind === "settings-project" || page.kind === "settings-plugin";
```

Передать значение в `ShellWithPlaceTabs.rightUnavailable` и
`CommandPalette.host.rightUnavailable`.

- [x] **Step 4: Run test to verify it passes**

Run ту же точечную команду. Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/commands/core-commands.ts apps/web/src/commands/core-commands.test.ts
git commit -m "fix(web): disable unavailable panel commands"
```

### Task 2: Точный аккорд палитры

**Files:**

- Modify: `apps/web/src/commands/command-palette.test.tsx`
- Modify: `apps/web/src/commands/command-palette.tsx`

**Interfaces:**

- Consumes: native `KeyboardEvent` modifier flags.
- Produces: `useCommandPaletteShortcut` принимает только XOR `metaKey`/`ctrlKey` при выключенных
  `shiftKey` и `altKey`.

- [x] **Step 1: Write the failing test**

Добавить table-driven проверку реальных событий:

```ts
it.each([
  { ctrlKey: true, shiftKey: true },
  { ctrlKey: true, altKey: true },
  { metaKey: true, shiftKey: true },
  { metaKey: true, altKey: true },
  { metaKey: true, ctrlKey: true },
])("leaves modified Cmd or Ctrl+K chords alone", (modifiers) => {
  render(<Probe />);
  const event = new KeyboardEvent("keydown", {
    key: "k",
    cancelable: true,
    ...modifiers,
  });

  act(() => window.dispatchEvent(event));

  expect(event.defaultPrevented).toBe(false);
  expect(screen.getByText("opened 0")).toBeDefined();
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @sovereign/web test -- src/commands/command-palette.test.tsx
```

Expected: FAIL because each current modified chord opens the palette.

- [x] **Step 3: Write minimal implementation**

```ts
const platformModifier = event.metaKey !== event.ctrlKey;

if (event.key.toLowerCase() !== "k" || !platformModifier || event.shiftKey || event.altKey) {
  return;
}
```

- [x] **Step 4: Run test to verify it passes**

Run ту же точечную команду. Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/web/src/commands/command-palette.tsx apps/web/src/commands/command-palette.test.tsx
git commit -m "fix(web): narrow the command palette shortcut"
```

### Task 3: Семантика выключенной строки `ListRow`

**Files:**

- Modify: `packages/ui-kit/src/components/interactive-components.test.tsx`
- Modify: `packages/ui-kit/src/components/list.tsx`
- Modify: `packages/ui-kit/src/components/list.module.css`
- Modify: `apps/web/src/commands/command-palette.test.tsx`
- Modify: `apps/web/src/commands/command-palette.tsx`
- Modify: `docs/ui-kit.md`

**Interfaces:**

- Consumes: существующие `ListRowProps.onSelect` и `.select` CSS.
- Produces: `ListRowProps.disabled?: boolean`; выключенная команда палитры остаётся нативной кнопкой.

- [x] **Step 1: Write the failing UI-kit test**

```tsx
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
```

- [x] **Step 2: Run UI-kit test to verify it fails**

Run:

```bash
NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @sovereign/ui-kit test -- src/components/interactive-components.test.tsx
```

Expected: FAIL at TypeScript transform or assertion because `disabled` is absent.

- [x] **Step 3: Implement `ListRow.disabled`**

Добавить prop, передать нативные атрибуты и убрать hover/cursor у выключенной строки:

```tsx
disabled?: boolean;

<button
  disabled={disabled}
  aria-disabled={disabled}
  // existing props
>
```

```css
.select:disabled {
  cursor: default;
  opacity: 0.55;
}

.select:hover:not(:disabled) {
  background: var(--sovereign-control-surface-hover);
}
```

- [x] **Step 4: Run UI-kit test to verify it passes**

Run ту же UI-kit команду. Expected: PASS.

- [x] **Step 5: Write the failing palette test**

Изменить ожидание недоступной команды с отсутствующей кнопки на выключенную кнопку:

```ts
const hidden = screen.getByRole("button", { name: "Hide the side panel" });
expect(hidden.hasAttribute("disabled")).toBe(true);
expect(hidden.getAttribute("aria-disabled")).toBe("true");
```

Такую же семантику ожидать для недоступной plugin command и исключения из `available`.

- [x] **Step 6: Run palette test to verify it fails**

Run точечную web-команду из Task 2. Expected: FAIL because disabled entries are still plain `li`.

- [x] **Step 7: Implement palette integration**

```tsx
<ListRow key={entry.id} onSelect={() => choose(entry)} disabled={entry.disabled}>
  {entry.title}
</ListRow>
```

Обновить комментарий палитры и публичное описание `ListRow` в `docs/ui-kit.md`.

- [x] **Step 8: Run both focused suites**

Run обе точечные команды Task 2 и Task 3. Expected: PASS.

- [x] **Step 9: Commit**

```bash
git add packages/ui-kit/src/components/list.tsx packages/ui-kit/src/components/list.module.css packages/ui-kit/src/components/interactive-components.test.tsx apps/web/src/commands/command-palette.tsx apps/web/src/commands/command-palette.test.tsx docs/ui-kit.md
git commit -m "fix(ui-kit): preserve disabled list row semantics"
```

### Task 4: Актуальная документация и полная проверка

**Files:**

- Modify: `docs/runbook.md`
- Modify: `docs/superpowers/specs/2026-08-09-slice-12c1-tabs-and-commands-design.md`
- Modify: `docs/superpowers/plans/2026-08-09-slice-12c1-final-review-fixes.md`

**Interfaces:**

- Consumes: фактические семь `settingsSections` и четыре panel commands.
- Produces: документация сообщает 13 core-команд и 7 Settings-разделов.

- [x] **Step 1: Correct the counts**

Заменить «двенадцать команд ядра» на «тринадцать команд ядра» в runbook и «шесть разделов
настроек» на «семь разделов настроек» в исходной spec.

- [x] **Step 2: Run focused tests together**

```bash
NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @sovereign/web test -- src/commands/core-commands.test.ts src/commands/command-palette.test.tsx
NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @sovereign/ui-kit test -- src/components/interactive-components.test.tsx
```

Expected: PASS.

- [x] **Step 3: Run full verification**

```bash
NODE_OPTIONS=--no-experimental-webstorage make check
NODE_OPTIONS=--no-experimental-webstorage make build
git diff --check
git status --short
git diff --stat main...HEAD
```

Expected: all commands exit 0; only the known Vite chunk-size warning remains; worktree contains only
the plan checkbox update and documentation count changes before the final commit.

- [x] **Step 4: Mark this plan complete and commit docs**

Отметить все steps `[x]`, затем:

```bash
git add docs/runbook.md docs/superpowers/specs/2026-08-09-slice-12c1-tabs-and-commands-design.md docs/superpowers/plans/2026-08-09-slice-12c1-final-review-fixes.md
git commit -m "docs(web): reconcile slice 12c-1 command counts"
```

- [x] **Step 5: Verify the final tree**

```bash
git status --short --branch
git log --oneline -6
git diff --check main...HEAD
```

Expected: feature worktree clean and all final review-fix commits visible.
