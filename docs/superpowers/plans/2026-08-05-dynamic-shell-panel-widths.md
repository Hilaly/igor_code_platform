# Dynamic Shell Panel Widths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Убрать фиксированный максимум `560 px` у боковых панелей и ограничивать их фактическую ширину доступным местом окна с резервом `320 px` для центральной страницы.

**Architecture:** Чистые функции в `shell/layout.ts` сохраняют постоянное предпочтение ширины и рассчитывают динамический максимум из геометрии оболочки. `Shell` отслеживает ширину окна, передаёт каждому ресайзеру его максимум и использует безопасно ограниченную ширину только для рендера, не перезаписывая сохранённое предпочтение при временном сужении окна.

**Tech Stack:** TypeScript, React 19, Vitest, Testing Library, jsdom, pnpm.

## Global Constraints

- Минимальная ширина панели — ровно `160 px`.
- Резерв центральной страницы — ровно `320 px`.
- Ширина видимого ресайзера — ровно `5 px`, как в `shell.css`.
- Скрытая или временно недоступная панель и её ресайзер не участвуют в расчёте занятого места.
- `localStorage` хранит конечные ширины без фиксированного верхнего ограничения.
- Начальные ширины, скрытие панелей и внешний вид оболочки не меняются.

---

### Task 1: Dynamic shell panel limits

**Files:**

- Modify: `apps/web/src/shell/layout.ts`
- Test: `apps/web/src/shell/layout.test.ts`
- Modify: `apps/web/src/shell/shell.tsx`
- Test: `apps/web/src/shell/shell.test.tsx`
- Modify: `docs/ui-kit.md`

**Interfaces:**

- Consumes: `ShellLayout`, `defaultLayout`, браузерные `window.innerWidth` и событие `resize`.
- Produces: `panelWidthLimits.minimum === 160`, `shellCenterMinimumWidth === 320`, `shellResizerWidth === 5`, `maximumPanelWidth(viewportWidth: number, oppositePanelWidth?: number): number`, `clampPanelWidth(width: number, maximum?: number): number`.

- [x] **Step 1: Write failing layout tests for persistent and dynamic limits**

В `layout.test.ts` заменить проверку фиксированного максимума и дополнить `clampPanelWidth` такими требованиями:

```ts
it("keeps a large finite preference while restoring the layout", () => {
  const layout = readLayout(storage(JSON.stringify({ leftWidth: 3, rightWidth: 9000 })));

  expect(layout.leftWidth).toBe(panelWidthLimits.minimum);
  expect(layout.rightWidth).toBe(9000);
});

it("leaves the center reserve and visible edges in the viewport", () => {
  expect(maximumPanelWidth(1440)).toBe(1115);
  expect(maximumPanelWidth(1440, 400)).toBe(710);
});

it("never returns a maximum below the panel minimum", () => {
  expect(maximumPanelWidth(300, 400)).toBe(panelWidthLimits.minimum);
});

it("uses a supplied dynamic maximum", () => {
  expect(clampPanelWidth(900, 710)).toBe(710);
});
```

Импортировать `maximumPanelWidth` рядом с существующими экспортами.

- [x] **Step 2: Run the layout test and verify RED**

Run: `pnpm --filter @sovereign/web test -- src/shell/layout.test.ts`

Expected: FAIL, потому что `maximumPanelWidth` ещё не экспортируется, `panelWidthLimits.maximum` всё ещё обрезает `9000`, а минимум равен `180`.

- [x] **Step 3: Implement persistent minimum and pure dynamic calculations**

В `layout.ts`:

```ts
export const panelWidthLimits = { minimum: 160 };
export const shellCenterMinimumWidth = 320;
export const shellResizerWidth = 5;

export function maximumPanelWidth(viewportWidth: number, oppositePanelWidth = 0): number {
  const visibleResizerCount = oppositePanelWidth > 0 ? 2 : 1;
  return Math.max(
    panelWidthLimits.minimum,
    Math.floor(
      viewportWidth -
        oppositePanelWidth -
        shellCenterMinimumWidth -
        shellResizerWidth * visibleResizerCount,
    ),
  );
}

export function clampPanelWidth(width: number, maximum = Number.POSITIVE_INFINITY): number {
  if (!Number.isFinite(width)) {
    return defaultLayout.leftWidth;
  }

  return Math.min(maximum, Math.max(panelWidthLimits.minimum, Math.round(width)));
}
```

`readLayout` продолжает вызывать `clampPanelWidth` без максимума, поэтому нормализует минимум и не уничтожает большое конечное предпочтение.

- [x] **Step 4: Run the layout test and verify GREEN**

Run: `pnpm --filter @sovereign/web test -- src/shell/layout.test.ts`

Expected: PASS, все тесты файла зелёные без предупреждений.

- [x] **Step 5: Write failing component tests for the viewport-aware resizers**

В `shell.test.tsx` задать управляемую ширину окна через `Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 })` в `beforeEach`. Проверить:

```ts
it("announces and applies the viewport maximum", () => {
  const { onLayoutChange } = show();
  const left = screen.getByRole("separator", { name: "левая панель" });

  expect(left.getAttribute("aria-valuemax")).toBe("1115");
  drag(left, 100, [5000]);
  expect(onLayoutChange).toHaveBeenLastCalledWith({ ...defaultLayout, leftWidth: 1115 });
});

it("subtracts the visible opposite panel from each maximum", () => {
  show({ layout: rightVisible });

  expect(
    screen.getByRole("separator", { name: "левая панель" }).getAttribute("aria-valuemax"),
  ).toBe("790");
  expect(
    screen.getByRole("separator", { name: "правая панель" }).getAttribute("aria-valuemax"),
  ).toBe("850");
});

it("temporarily clamps rendered widths after a viewport resize", () => {
  const wide = { ...defaultLayout, leftWidth: 900 };
  show({ layout: wide });

  Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
  fireEvent(window, new Event("resize"));

  expect(screen.getByRole("navigation", { name: "левая панель" }).getAttribute("style")).toContain(
    "width: 475px",
  );
});
```

Точные ожидания следуют формуле: `1440 - 320 - 5 = 1115`; при обеих панелях
`1440 - 320 - 5 - 5 - opposite` (`790` слева при правой `320`, `850` справа при левой `260`); при
окне `800 px` — `800 - 320 - 5 = 475`.

- [x] **Step 6: Run the component test and verify RED**

Run: `pnpm --filter @sovereign/web test -- src/shell/shell.test.tsx`

Expected: FAIL: ARIA всё ещё использует удалённый фиксированный максимум, drag не знает динамического максимума, а изменение `window.innerWidth` не вызывает перерасчёт рендера.

- [x] **Step 7: Implement viewport-aware rendering and resizing**

В `shell.tsx` добавить локальный хук без нового файла:

```ts
function useViewportWidth(): number {
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);

  useEffect(() => {
    const update = (): void => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return viewportWidth;
}
```

Импортировать `useEffect`, `useState`, `maximumPanelWidth`. В `Shell` вычислить `leftMaximum` и `rightMaximum`; учитывать `rightVisible`, `layout.leftHidden` и для противоположной панели использовать её уже ограниченную доступным максимумом ширину. Для `style.width`, `PanelResizer.width` и `aria-valuenow` передавать фактическую ширину `clampPanelWidth(layout.*Width, *Maximum)`, но в `onLayoutChange` менять сохранённую ширину только вследствие жеста пользователя.

Расширить `PanelResizerProps` полем `maximum: number`, поставить `aria-valuemax={maximum}` и применять `clampPanelWidth(candidate, maximum)` для pointer и keyboard.

- [x] **Step 8: Run targeted tests and verify GREEN**

Run: `pnpm --filter @sovereign/web test -- src/shell/layout.test.ts src/shell/shell.test.tsx`

Expected: PASS, оба файла зелёные без предупреждений.

- [x] **Step 9: Update the canonical UI documentation**

В разделе «Оболочка» файла `docs/ui-kit.md` заменить утверждение о едином фиксированном диапазоне описанием: минимум `160 px`, максимум зависит от окна, центр получает резерв `320 px`, временное сужение окна не перезаписывает предпочтение в `localStorage`.

- [x] **Step 10: Run formatter and targeted regression tests**

Run: `pnpm exec prettier --write apps/web/src/shell/layout.ts apps/web/src/shell/layout.test.ts apps/web/src/shell/shell.tsx apps/web/src/shell/shell.test.tsx docs/ui-kit.md docs/superpowers/plans/2026-08-05-dynamic-shell-panel-widths.md`

Run: `pnpm --filter @sovereign/web test -- src/shell/layout.test.ts src/shell/shell.test.tsx`

Expected: formatter exits `0`; tests PASS without warnings.

- [x] **Step 11: Run the full repository verification**

Run: `make check && make build`

Expected: typecheck, ESLint, Prettier, all tests and the web production build exit `0` without new warnings.

- [x] **Step 12: Commit the implementation**

```bash
git add apps/web/src/shell/layout.ts apps/web/src/shell/layout.test.ts \
  apps/web/src/shell/shell.tsx apps/web/src/shell/shell.test.tsx docs/ui-kit.md
git commit -m "fix(web): make panel widths viewport-aware"
```
