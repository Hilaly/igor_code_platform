# Портальные всплывающие слои UI Kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перевести все popup-компоненты UI Kit на единый portal-based слой, чтобы они не зависели от stacking context предков и корректно помещались в viewport.

**Architecture:** Добавить внутренний `FloatingLayer`, который портирует содержимое в `ownerDocument.body`, измеряет trigger/content через `getBoundingClientRect`, выбирает сторону и зажимает координаты. Компоненты сохраняют собственное состояние, роли, keyboard navigation и focus management; `FloatingLayer` отвечает только за DOM placement and geometry. `Menu` и `Tree` удаляют дублирующие portal/positioning ветки, `Popover` становится адаптером общего слоя.

**Tech Stack:** React 19, TypeScript, `createPortal` из `react-dom`, CSS Modules, Vitest + Testing Library + jsdom.

## Global Constraints

- Не добавлять runtime-зависимости.
- Публичные props popup-компонентов и их ARIA-контракты не менять.
- Открытый слой всегда рендерить в `ownerDocument.body` и позиционировать через `position: fixed`.
- Закрытие по outside click должно учитывать и trigger-root, и портальный popup.
- Проверять тестами keyboard navigation, Escape, resize/scroll и viewport collision.
- Документация на русском; код, идентификаторы и commit messages на английском.

---

### Task 1: Общий FloatingLayer

**Files:**

- Create: `packages/ui-kit/src/components/floating-layer.tsx`
- Create: `packages/ui-kit/src/components/floating-layer.module.css`
- Create: `packages/ui-kit/src/components/floating-layer.test.tsx`
- Modify: `packages/ui-kit/src/index.ts`

**Interfaces:**

- Produces `FloatingLayerProps`: `open`, `anchorRef`, `children`, `side?: "top" | "bottom" | "left" | "right"`, `matchAnchorWidth?: boolean`, `minWidth?: number`, `offset?: number`, `role?: string`, `ariaLabel?: string`, `className?: string`, `onPointerDownOutside?: (event: PointerEvent) => void`.
- Produces a portal root with `data-side`, fixed `style.left/top/maxWidth/maxHeight/minWidth`, and the supplied role/label.

- [ ] **Step 1: Write failing geometry and portal tests**

```tsx
it("renders open content in document.body and aligns it to the anchor", () => {
  const anchorRef = { current: document.createElement("button") };
  document.body.append(anchorRef.current);
  vi.spyOn(anchorRef.current, "getBoundingClientRect").mockReturnValue({
    left: 100,
    right: 300,
    top: 200,
    bottom: 240,
    width: 200,
    height: 40,
    x: 100,
    y: 200,
    toJSON: () => {},
  });
  render(
    <FloatingLayer open anchorRef={anchorRef}>
      <div role="listbox">items</div>
    </FloatingLayer>,
  );
  expect(screen.getByRole("listbox").parentElement).toBe(document.body);
  expect(screen.getByRole("listbox").parentElement?.getAttribute("data-side")).toBe("bottom");
});
```

Добавить тесты на переворот, зажим в viewport, `matchAnchorWidth`, resize и scroll. Использовать
`vi.stubGlobal("innerWidth", ...)` и mocked rects, чтобы тесты не зависели от реального layout jsdom.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm --filter @sovereign/ui-kit test -- floating-layer.test.tsx`

Expected: FAIL because `FloatingLayer` is not implemented.

- [ ] **Step 3: Implement minimal portal and geometry**

Реализовать `createPortal` только при `open` и наличии `anchorRef.current`/`ownerDocument.body`.
Измерять popup после первого render через `useLayoutEffect`; до измерения использовать безопасные
координаты и `visibility: hidden`. На `resize` и `scroll` (`capture: true`) пересчитывать позицию.
Выбирать противоположную сторону, когда preferred side не помещается и fallback даёт больше места;
затем clamp по `8px` viewport gutter. Для ширины выбора использовать `minWidth`/anchor width.

- [ ] **Step 4: Run focused tests and verify pass**

Run: `pnpm --filter @sovereign/ui-kit test -- floating-layer.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui-kit/src/components/floating-layer* packages/ui-kit/src/index.ts
git commit -m "feat(ui-kit): add shared portal floating layer"
```

### Task 2: Перевод списков выбора

**Files:**

- Modify: `packages/ui-kit/src/components/select.tsx`
- Modify: `packages/ui-kit/src/components/select.module.css`
- Modify: `packages/ui-kit/src/components/combobox.tsx`
- Modify: `packages/ui-kit/src/components/combobox.module.css`
- Modify: `packages/ui-kit/src/components/multi-select.tsx`
- Modify: `packages/ui-kit/src/components/multi-select.module.css`
- Modify: `packages/ui-kit/src/components/interactive-components.test.tsx`

**Interfaces:**

- Consumes `FloatingLayer` from Task 1 with each component's existing `rootRef`, `listId` and listbox markup.
- Produces unchanged `SelectProps`, `ComboboxProps<T>` and `MultiSelectProps<T>` behavior.

- [ ] **Step 1: Add regression tests for separate DOM trees**

Для каждого компонента открыть popup и проверить `popup.parentElement === document.body`, затем
проверить выбор пункта кликом, Escape и outside pointerdown. Для `Combobox` сохранить фильтрацию,
для `MultiSelect` — незакрытие после toggle.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm --filter @sovereign/ui-kit test -- interactive-components.test.tsx`

Expected: new body-parent assertions FAIL while current behavior tests remain informative.

- [ ] **Step 3: Replace local dropdown branches with FloatingLayer**

Передать `anchorRef={rootRef}`, `side="bottom"`, `matchAnchorWidth`, `role="listbox"` and the
existing list `id`; move only the popup JSX into `children`. Outside click handlers must test both
`rootRef` and the portalled popup through `FloatingLayer` callback. Remove obsolete absolute `top`
and `inset-inline` declarations, retaining option surfaces and scrolling.

- [ ] **Step 4: Run focused tests and verify pass**

Run: `pnpm --filter @sovereign/ui-kit test -- interactive-components.test.tsx`

Expected: PASS with all existing keyboard and selection assertions.

- [ ] **Step 5: Commit**

```bash
git add packages/ui-kit/src/components/{select,combobox,multi-select}* packages/ui-kit/src/components/interactive-components.test.tsx
git commit -m "fix(ui-kit): portal selection popups"
```

### Task 3: Перевод Popover, Menu, ModelPicker и Tree

**Files:**

- Modify: `packages/ui-kit/src/components/popover.tsx`
- Modify: `packages/ui-kit/src/components/popover.module.css`
- Modify: `packages/ui-kit/src/components/menu.tsx`
- Modify: `packages/ui-kit/src/components/menu.module.css`
- Modify: `packages/ui-kit/src/components/tree.tsx`
- Modify: `packages/ui-kit/src/components/tree-context-card.tsx`
- Modify: `packages/ui-kit/src/components/tree.module.css`
- Modify: `packages/ui-kit/src/components/interactive-components.test.tsx`
- Modify: `packages/ui-kit/src/components/next-turn-picker.test.tsx`

**Interfaces:**

- Consumes `FloatingLayer` from Task 1.
- Produces unchanged public props and existing `ModelPicker` behavior through `Popover`.

- [ ] **Step 1: Add tests for all popup roots in body**

Проверить body-parent для `Popover`, обычного и compact/hover `Menu`, model picker popup и tree
context card. Для `Menu` сохранить переход фокуса и hover bridge; для `Popover` сохранить
controlled open/close and focus restore.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm --filter @sovereign/ui-kit test -- interactive-components.test.tsx next-turn-picker.test.tsx`

Expected: new body-parent assertions FAIL before migration.

- [ ] **Step 3: Migrate each component to FloatingLayer**

`Popover` передаёт trigger ref and its `side`; removes local `useLayoutEffect` viewport math.
`Menu` uses the same layer for both placement modes and keeps its hover close timer independent of
geometry. `Tree` uses the layer for context card and keeps node hover/focus state local. Remove the
now-duplicated `createPortal`, fixed-position and viewport calculation code, preserving component CSS
for panel appearance.

- [ ] **Step 4: Run focused tests and verify pass**

Run: `pnpm --filter @sovereign/ui-kit test -- interactive-components.test.tsx next-turn-picker.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui-kit/src/components/{popover,menu,tree,tree-context-card}* packages/ui-kit/src/components/{interactive-components,next-turn-picker}.test.tsx
git commit -m "refactor(ui-kit): share portal geometry across popups"
```

### Task 4: Appearance regression, catalog and documentation

**Files:**

- Modify: `apps/web/src/settings/appearance-section.test.tsx`
- Modify: `packages/ui-kit/src/components/ported.stories.tsx`
- Modify: `docs/ui-kit.md`
- Modify: `packages/ui-kit/src/styles/styles.test.ts`

- [ ] **Step 1: Add Appearance regression test**

Открыть combobox `Colour scheme` в `appearance-section.test.tsx` и проверить, что `role=listbox`
находится в `document.body`, а не внутри `SettingsRow`; убедиться, что соседние Theme/scale controls
остаются под меню только визуально, а DOM не содержит локального dropdown.

- [ ] **Step 2: Run regression test and verify failure**

Run: `pnpm --filter @sovereign/web test -- appearance-section.test.tsx`

Expected: FAIL against the pre-migration local dropdown.

- [ ] **Step 3: Update catalog story and CSS contract tests**

Добавить в `ported.stories.tsx` компактную историю с `SettingsRow` и открываемым `Select` рядом с
сегментированными контролами. Обновить style assertions так, чтобы они требовали fixed portal
geometry through `FloatingLayer`, но не возвращали компонентные absolute dropdown.

- [ ] **Step 4: Update `docs/ui-kit.md`**

В разделе примитивов описать общий portal/floating contract, список потребителей и правило
outside-click/focus ownership. В «Почему так» сослаться на stacking context и отвергнутый row z-index.

- [ ] **Step 5: Run full verification**

Run: `pnpm --filter @sovereign/ui-kit typecheck && pnpm --filter @sovereign/ui-kit test && pnpm --filter @sovereign/web test -- appearance-section.test.tsx`

Expected: PASS with no new warnings.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/settings/appearance-section.test.tsx packages/ui-kit/src/components/ported.stories.tsx packages/ui-kit/src/styles/styles.test.ts docs/ui-kit.md
git commit -m "test(ui-kit): cover portal overlays in appearance"
```

## Plan Self-Review

- Spec coverage: portal, geometry, all popup consumers, accessibility, outside click, resize/scroll,
  tests, documentation, and rejected alternatives are covered by Tasks 1–4.
- Placeholder scan: no `TBD`, `TODO`, `FIXME`, or vague “write tests” steps are present.
- Type consistency: every consumer takes `anchorRef`, `side`, optional width matching, and the shared
  layer owns only positioning/portal concerns.
