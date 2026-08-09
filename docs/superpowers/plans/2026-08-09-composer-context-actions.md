# Composer Context And Send Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move context usage into the composer as a circular tooltip-backed indicator and replace competing send controls with one primary action plus an alternatives menu.

**Architecture:** Extend existing UI Kit primitives instead of introducing application-local tooltip or menu behaviour. `Progress` gains a circular presentation, `Tooltip` accepts structured static content, and a public `SplitButton` composes the existing `Button` and `Menu`. The web layer keeps usage formatting in `session-usage.tsx`, passes usage into `MessageComposer`, and maps each send alternative directly to the existing protocol mode without persistent mode state.

**Tech Stack:** React 19, TypeScript, CSS Modules in `@sovereign/ui-kit`, application CSS in `apps/web`, Vitest, Testing Library, pnpm workspace.

## Global Constraints

- Work only in `/Users/user/repos/sovereign_platform_node/.worktrees/composer-context-actions` on `feat/composer-context-actions`.
- Use the existing `Tooltip`; do not add local tooltip state, handlers, portals, positioning, or a second tooltip type.
- Tooltip content is static; interactive actions belong in `Menu`/`SplitButton`.
- Toolbar order: circular context progress, model/reasoning, stop, send-with-menu; the left slot stays reserved.
- Stop is always rendered and enabled only while a turn is active.
- Primary click and Enter keep the existing default: ordinary turn while idle, `steer` while busy.
- The menu contains `append` in both states and adds `follow-up` and `next-turn` while busy; a selection never persists as a mode.
- UI Kit owns primitive visuals and public interaction contracts; application CSS only composes them.
- Run web tests under Node 24 with `NODE_OPTIONS=--no-experimental-webstorage` so jsdom owns `localStorage`.
- Do not add dependencies.

---

### Task 1: Structured content in the shared Tooltip

**Files:**

- Modify: `packages/ui-kit/src/components/tooltip.tsx`
- Test: `packages/ui-kit/src/components/rendering.test.tsx`
- Test: `packages/ui-kit/src/components/surfaces.test.tsx`

**Interfaces:**

- Produces: `TooltipProps.content: ReactNode` while preserving string callers and existing `aria-describedby` behaviour.
- Consumes: the current CSS-only Tooltip interaction contract unchanged.

- [ ] **Step 1: Write the failing structured-content test**

```tsx
it("keeps structured static content inside the shared tooltip", () => {
  render(
    <Tooltip
      content={
        <div>
          <span>Context window</span>
          <hr />
          <span>Session tokens: 700</span>
        </div>
      }
    >
      <button type="button">Usage</button>
    </Tooltip>,
  );

  const trigger = screen.getByRole("button", { name: "Usage" });
  const tooltip = screen.getByRole("tooltip");
  expect(tooltip.textContent).toContain("Context window");
  expect(tooltip.textContent).toContain("Session tokens: 700");
  expect(trigger.getAttribute("aria-describedby")).toBe(tooltip.id);
});
```

- [ ] **Step 2: Run the test and typecheck to verify RED**

Run: `pnpm --filter @sovereign/ui-kit test -- rendering.test.tsx && pnpm --filter @sovereign/ui-kit typecheck`

Expected: the runtime assertion passes through the existing renderer, then typecheck FAILS because
`TooltipProps.content` accepts only `string`. This is the regression boundary: the DOM mechanism
already supports nodes, but the public TypeScript contract forbids them.

- [ ] **Step 3: Widen the existing prop without changing behaviour**

```ts
export type TooltipProps = {
  content: ReactNode;
  id?: string;
  side?: TooltipSide;
  hoverOnly?: boolean;
  children: ReactNode;
};
```

Do not change `tooltip.module.css`, event handling, positioning, portal usage, or trigger cloning.

- [ ] **Step 4: Run Tooltip regressions**

Run: `pnpm --filter @sovereign/ui-kit test -- rendering.test.tsx surfaces.test.tsx styles.test.ts`

Expected: PASS, including string content, merged `aria-describedby`, idle-overflow, keyboard modality, and shrink tests.

- [ ] **Step 5: Commit**

```bash
git add packages/ui-kit/src/components/tooltip.tsx packages/ui-kit/src/components/rendering.test.tsx packages/ui-kit/src/components/surfaces.test.tsx
git commit -m "feat(ui-kit): allow structured tooltip content"
```

### Task 2: Circular presentation for Progress

**Files:**

- Modify: `packages/ui-kit/src/components/progress.tsx`
- Modify: `packages/ui-kit/src/components/progress.module.css`
- Test: `packages/ui-kit/src/components/rendering.test.tsx`
- Test: `packages/ui-kit/src/components/progress.test.ts`
- Test: `packages/ui-kit/src/styles/styles.test.ts`

**Interfaces:**

- Produces: `ProgressProps.variant?: "linear" | "circular"` and `ProgressProps.tabIndex?: number`; linear remains default.
- Consumes: existing value clamping, tone, label, and indeterminate semantics.

- [ ] **Step 1: Write failing circular Progress tests**

```tsx
it("renders a focusable circular progressbar with the clamped percentage", () => {
  render(<Progress variant="circular" value={0.19} label="Context" tabIndex={0} />);
  const progress = screen.getByRole("progressbar", { name: "Context" });
  expect(progress.tagName).toBe("svg");
  expect(progress.getAttribute("aria-valuenow")).toBe("19");
  expect(progress.getAttribute("tabindex")).toBe("0");
  expect(progress.querySelectorAll("circle")).toHaveLength(2);
});

it("keeps an unknown circular value indeterminate", () => {
  render(<Progress variant="circular" label="Context" />);
  expect(screen.getByRole("progressbar", { name: "Context" }).hasAttribute("aria-valuenow")).toBe(
    false,
  );
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @sovereign/ui-kit test -- rendering.test.tsx progress.test.ts`

Expected: FAIL because `variant` and `tabIndex` do not exist.

- [ ] **Step 3: Implement the minimal circular SVG branch**

Keep the linear branch untouched. Render a 24×24 SVG with two circles and `pathLength="100"`; put the clamped percent in `--progress-number` and preserve `role="progressbar"` and `aria-value*`.

```tsx
<svg
  className={`${styles.circular} ${styles[tone]}`}
  viewBox="0 0 24 24"
  style={{ "--progress-number": percent } as CSSProperties}
  role="progressbar"
  aria-label={label}
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuenow={percent}
  tabIndex={tabIndex}
>
  <circle className={styles.circularTrack} cx="12" cy="12" r="9" pathLength="100" />
  <circle className={styles.circularValue} cx="12" cy="12" r="9" pathLength="100" />
</svg>
```

Use semantic token strokes and `stroke-dasharray`/`stroke-dashoffset`, not gradients. Unknown value keeps `aria-value*` absent and gets a reduced-motion-safe indeterminate treatment.

- [ ] **Step 4: Add style-contract assertions**

Require a compact square, `fill: none`, semantic tone strokes, and reduced-motion handling while preserving existing linear selectors.

- [ ] **Step 5: Run Progress tests**

Run: `pnpm --filter @sovereign/ui-kit test -- rendering.test.tsx progress.test.ts styles.test.ts`

Expected: PASS for linear and circular variants.

- [ ] **Step 6: Commit**

```bash
git add packages/ui-kit/src/components/progress.tsx packages/ui-kit/src/components/progress.module.css packages/ui-kit/src/components/rendering.test.tsx packages/ui-kit/src/components/progress.test.ts packages/ui-kit/src/styles/styles.test.ts
git commit -m "feat(ui-kit): add circular progress presentation"
```

### Task 3: Public SplitButton built from Button and Menu

**Files:**

- Create: `packages/ui-kit/src/components/split-button.tsx`
- Create: `packages/ui-kit/src/components/split-button.module.css`
- Modify: `packages/ui-kit/src/components/menu.tsx`
- Modify: `packages/ui-kit/src/components/icons.tsx`
- Modify: `packages/ui-kit/src/index.ts`
- Test: `packages/ui-kit/src/components/interactive-components.test.tsx`
- Test: `packages/ui-kit/src/components/rendering.test.tsx`
- Test: `packages/ui-kit/src/styles/styles.test.ts`
- Modify: `docs/ui-kit.md`

**Interfaces:**

```ts
export type SplitButtonProps = {
  action: ReactNode;
  actionLabel: string;
  onAction: () => void;
  menuLabel: string;
  menuTriggerLabel: string;
  items: MenuItemDescription[];
  placement?: "below" | "above";
  tone?: ButtonTone;
  disabled?: boolean;
};
```

Also produces `MenuProps.disabled?: boolean` and a public `ChevronDownIcon`.

- [ ] **Step 1: Write failing SplitButton interaction tests**

```tsx
it("keeps the primary action separate from its alternatives menu", () => {
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
});
```

Add a disabled case proving neither half can act or open.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @sovereign/ui-kit test -- interactive-components.test.tsx rendering.test.tsx`

Expected: FAIL because `SplitButton`, `ChevronDownIcon`, and `Menu.disabled` do not exist.

- [ ] **Step 3: Add disabled support to Menu**

Add `disabled?: boolean`, put it on the native trigger, and guard hover/click opening paths. Existing callers default to enabled.

- [ ] **Step 4: Implement SplitButton**

Render one icon-only `Button` and one compact `Menu` trigger with `ChevronDownIcon` inside an inline-flex CSS Module wrapper. Pass the same disabled value to both halves. Do not add application-owned classes to UI Kit primitives.

- [ ] **Step 5: Export and document it**

Export `SplitButton` and `ChevronDownIcon`. Add the exact generic interface and rationale to `docs/ui-kit.md`.

- [ ] **Step 6: Run UI Kit tests and typecheck**

Run: `pnpm --filter @sovereign/ui-kit test`

Run: `pnpm --filter @sovereign/ui-kit typecheck`

Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/ui-kit/src/components/menu.tsx packages/ui-kit/src/components/split-button.tsx packages/ui-kit/src/components/split-button.module.css packages/ui-kit/src/components/icons.tsx packages/ui-kit/src/components/interactive-components.test.tsx packages/ui-kit/src/components/rendering.test.tsx packages/ui-kit/src/styles/styles.test.ts packages/ui-kit/src/index.ts docs/ui-kit.md
git commit -m "feat(ui-kit): add split action menu button"
```

### Task 4: Compact context indicator inside the composer

**Files:**

- Modify: `apps/web/src/sessions/session-usage.tsx`
- Modify: `apps/web/src/sessions/session-usage.test.tsx`
- Modify: `apps/web/src/sessions/message-composer.tsx`
- Modify: `apps/web/src/sessions/message-composer.test.tsx`
- Modify: `apps/web/src/sessions/chat-view.tsx`
- Modify: `packages/ui-kit/src/i18n/messages/en.ts`
- Modify: `packages/ui-kit/src/i18n/messages/ru.ts`
- Modify: `apps/web/src/sessions/sessions.css`
- Modify: `apps/web/src/shell/styles.test.ts`

**Interfaces:**

- `SessionUsage` becomes a compact tooltip-wrapped circular indicator but keeps `stats`, `context`, and `translator` props.
- `MessageComposerProps` gains `stats?: SessionStats` and `context?: SessionContextUsage`.
- The standalone `SessionUsage` sibling and `.sessions-usage*` full-width layout disappear.

- [ ] **Step 1: Rewrite SessionUsage tests first**

```tsx
render(<SessionUsage context={context({ tokens: 190 })} stats={stats()} translator={translator} />);
const progress = screen.getByRole("progressbar", { name: "Заполнение контекста" });
expect(progress.getAttribute("aria-valuenow")).toBe("19");
const tooltip = screen.getByRole("tooltip");
expect(within(tooltip).getByText("19% использовано · 81% осталось")).toBeTruthy();
expect(within(tooltip).getByText("190 / 1000 токенов")).toBeTruthy();
expect(within(tooltip).getByText("Токены сессии: 700")).toBeTruthy();
expect(within(tooltip).getByText("Стоимость: $0.1234")).toBeTruthy();
expect(tooltip.querySelector("hr")).not.toBeNull();
```

For an unknown context size, require indeterminate circular progress, no invented percentage, and the known token count.

- [ ] **Step 2: Run SessionUsage tests and verify RED**

Run: `NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @sovereign/web test -- session-usage.test.tsx`

Expected: FAIL because usage is still a full-width register with linear progress.

- [ ] **Step 3: Implement the shared-tooltip indicator**

```tsx
<Tooltip content={<div className="sessions-usage-tooltip">...</div>} side="top">
  <Progress
    variant="circular"
    value={share}
    tone={contextTone(context)}
    label={t("chat.context.label")}
    tabIndex={0}
  />
</Tooltip>
```

Put context details above `<hr />` and session totals below it. Add localized used/left and token strings. Inherit Tooltip typography; do not create another surface or font rule.

- [ ] **Step 4: Move usage into MessageComposer**

Render `SessionUsage` first in `.sessions-composer-actions`, pass `open.stats`/`open.context` from `ChatView`, and remove the standalone usage sibling.

- [ ] **Step 5: Remove full-width CSS and assert geometry**

Delete `.sessions-usage*` grid rules. Add only content spacing/divider rules. Keep the right group on one line and let the empty left slot shrink first.

- [ ] **Step 6: Run focused tests**

Run: `NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @sovereign/web test -- session-usage.test.tsx message-composer.test.tsx chat-view.test.tsx styles.test.ts`

Expected: usage and integration tests PASS; old send-control assertions are replaced in Task 5.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/sessions/session-usage.tsx apps/web/src/sessions/session-usage.test.tsx apps/web/src/sessions/message-composer.tsx apps/web/src/sessions/message-composer.test.tsx apps/web/src/sessions/chat-view.tsx apps/web/src/sessions/sessions.css apps/web/src/shell/styles.test.ts packages/ui-kit/src/i18n/messages/en.ts packages/ui-kit/src/i18n/messages/ru.ts
git commit -m "feat(web): move context usage into the composer"
```

### Task 5: Replace persistent delivery controls with SplitButton alternatives

**Files:**

- Modify: `apps/web/src/sessions/message-composer.tsx`
- Modify: `apps/web/src/sessions/message-composer.test.tsx`
- Modify: `apps/web/src/sessions/sessions.css`
- Modify: `apps/web/src/shell/styles.test.ts`
- Modify: `packages/ui-kit/src/i18n/messages/en.ts`
- Modify: `packages/ui-kit/src/i18n/messages/ru.ts`
- Modify: `docs/ui-kit.md`
- Modify: `docs/superpowers/specs/2026-08-06-compact-session-composer-design.md`

**Interfaces:**

- Removes `mode` state, `busyModes`, `SegmentedControl`, standalone append, and `.sessions-modes`.
- Default send maps idle to `onSubmit(TurnRequest)` and busy to `onSendMessage({ mode: "steer" })`.
- Menu alternatives map directly to `append`, and while busy to `follow-up` and `next-turn`.

- [ ] **Step 1: Rewrite composer action tests first**

```tsx
expect(screen.queryByRole("radiogroup")).toBeNull();
expect(screen.getByRole("button", { name: "Отправить" })).toBeTruthy();
expect(screen.getByRole("button", { name: "Варианты отправки" })).toBeTruthy();
expect(screen.getByRole("button", { name: "Остановить" }).hasAttribute("disabled")).toBe(true);
```

Open the idle menu and require only append. Open the busy menu and require append, follow-up, and next-turn. Select each item and assert the exact existing `SessionMessage.mode`. After an alternative, press Enter on a new draft and assert default `steer` to prove no mode persisted.

- [ ] **Step 2: Run composer tests and verify RED**

Run: `NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @sovereign/web test -- message-composer.test.tsx`

Expected: FAIL because the segmented control, mode state, standalone append, and conditional stop remain.

- [ ] **Step 3: Replace mode state with direct actions**

Keep the existing async acceptance token/settlement logic. Extract `sendMessage(mode)` and `submitTurn()`, then point both Textarea Enter and the primary action to:

```ts
const sendDefault = (): void => {
  if (busy) {
    sendMessage("steer");
    return;
  }
  submitTurn();
};
```

Build alternatives directly:

```ts
const alternatives: MenuItemDescription[] = [
  { id: "append", label: t("chat.append"), onSelect: () => sendMessage("append") },
  ...(busy
    ? [
        {
          id: "follow-up",
          label: t("chat.mode.follow-up.send"),
          onSelect: () => sendMessage("follow-up"),
        },
        {
          id: "next-turn",
          label: t("chat.mode.next-turn.send"),
          onSelect: () => sendMessage("next-turn"),
        },
      ]
    : []),
];
```

- [ ] **Step 4: Render the approved stable order**

Render `SessionUsage`, `NextTurnPicker`, always-present Stop, then `SplitButton`. Stop uses `disabled={disabled || !busy}`. SplitButton uses `placement="above"`, send icon, and shared disabled state `disabled || submitting || draft.trim() === ""`.

- [ ] **Step 5: Remove obsolete CSS and update responsive tests**

Delete `.sessions-modes` and wrapping rules. Preserve the left flexible slot; keep the right group `flex-wrap: nowrap` and make the model control the shrinkable item.

- [ ] **Step 6: Run focused tests and typechecks**

Run: `NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @sovereign/web test -- message-composer.test.tsx session-usage.test.tsx chat-view.test.tsx styles.test.ts`

Run: `pnpm --filter @sovereign/web typecheck`

Expected: PASS.

- [ ] **Step 7: Update living documentation**

Update `docs/ui-kit.md` with the shipped circular Progress and SplitButton contracts. Rewrite implementation-oriented wording in the composer design spec to current behaviour.

- [ ] **Step 8: Run full verification**

```bash
pnpm --filter @sovereign/ui-kit test
pnpm --filter @sovereign/ui-kit typecheck
NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @sovereign/web test
pnpm --filter @sovereign/web typecheck
pnpm eslint .
pnpm prettier --check .
pnpm --filter @sovereign/web build
git diff --check
```

Expected: every command exits 0 with no new warnings.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/sessions/message-composer.tsx apps/web/src/sessions/message-composer.test.tsx apps/web/src/sessions/sessions.css apps/web/src/shell/styles.test.ts packages/ui-kit/src/i18n/messages/en.ts packages/ui-kit/src/i18n/messages/ru.ts docs/ui-kit.md docs/superpowers/specs/2026-08-06-compact-session-composer-design.md
git commit -m "feat(web): consolidate composer delivery actions"
```

- [ ] **Step 10: Review branch state**

Run: `git status --short && git log --oneline main..HEAD`

Expected: clean worktree and the plan plus five atomic implementation commits.
