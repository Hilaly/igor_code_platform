# Compact Session Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the session composer as one compact raised surface with a growing, themed-scroll textarea, icon-only actions, and a provider-aware cascading model/reasoning picker while preserving all existing turn and queue semantics.

**Architecture:** Keep `MessageComposer` as the owner of delivery mode and submission lifecycle. Add a UI-kit primitive for the combined next-turn controls that composes the existing `ModelPicker` provider catalog with reasoning options in a single popover and exposes controlled values/callbacks. Keep application CSS responsible only for composer placement and the textarea/toolbar layout; UI-kit components own control geometry, popover surfaces, icons, and focus behavior.

**Tech Stack:** TypeScript, React 19, Vitest, Testing Library, CSS Modules, `lucide-react`, `@sovereign/protocol`, `@sovereign/ui-kit`.

## Global Constraints

- The composer remains one `RaisedSurface`; no second card or scrollable wrapper is introduced around it.
- The only composer scrollbar is the vertical scrollbar of the growing `Textarea`; it uses a thin theme-aware treatment and no native-looking default chrome.
- `Enter` submits and `Shift+Enter` inserts a newline; `maxRows={12}` remains the growth ceiling.
- The bottom toolbar is one row on wide surfaces, with an empty flexible left slot reserved for future attachments/modes.
- Append, send, and busy interrupt are icon-only controls with localized accessible names and `Tooltip`; visible text buttons are removed.
- Model/reasoning is one combined trigger; its first level has exactly `Модель` and `Reasoning`, and each row opens a nested submenu.
- Model submenu reuses lazy `ModelPickerGroup[]` provider groups, keeps groups independently expandable, and marks the selected model.
- Model/reasoning overrides apply only to the next ordinary `TurnRequest`, never to busy queue messages or `append`.
- Existing draft clearing, acceptance/error handling, busy modes, append, interrupt, callbacks, HTTP contracts, and protocol types remain unchanged.
- No direct `lucide-react` imports from `apps/web`; named icons are exported by `@sovereign/ui-kit`.
- Every task is a TDD cycle and ends with an atomic Conventional Commit.

---

## File Map

- Create `packages/ui-kit/src/components/next-turn-picker.tsx`: controlled combined model/reasoning trigger and cascade, using `Popover`, the extracted provider-tree body, and existing reasoning option semantics.
- Create `packages/ui-kit/src/components/next-turn-picker.module.css`: only UI-kit-owned trigger, rows, nested popovers, provider list overflow, and focus/disabled states.
- Create `packages/ui-kit/src/components/next-turn-picker.test.tsx`: interaction, provider groups, nested menus, keyboard, close behavior, disabled reasoning, and controlled callbacks.
- Modify: `packages/ui-kit/src/components/model-picker.tsx` and `packages/ui-kit/src/components/model-picker.test.tsx`: extract the provider-group tree into an internal reusable menu body so the cascade can open it without a second model trigger.
- Modify: `packages/ui-kit/src/components/icons.tsx` and `packages/ui-kit/src/index.ts`: add named send/append/stop icons using the already-installed `lucide-react` dependency.
- Modify: `packages/ui-kit/src/components/rendering.test.tsx`: cover the three new public icon wrappers.
- Modify `apps/web/src/sessions/message-composer.tsx`: replace the options grid and text buttons with the new picker and icon-only toolbar while preserving handlers.
- Modify `apps/web/src/sessions/message-composer.test.tsx`: update selectors and add the new composer surface, toolbar, picker, icon accessibility, provider and textarea behavior tests.
- Modify `apps/web/src/sessions/sessions.css`: define the two-zone composer grid/flex layout, empty left slot, right toolbar, responsive constraints, and no application-owned surface chrome.
- Modify `apps/web/src/sessions/message-action-focus.test.ts` or add `apps/web/src/sessions/composer-scrollbar.test.ts`: assert textarea-only scrollbar selectors and absence of composer-level overflow.
- Modify `apps/web/src/shell/styles.test.ts`: replace obsolete option-grid/wrap assertions with the compact composer layout contract.
- Modify `packages/ui-kit/src/i18n/messages/en.ts` and `packages/ui-kit/src/i18n/messages/ru.ts`: add localized labels for combined picker, icon actions, and submenu labels where existing keys are insufficient.
- Modify `docs/ui-kit.md`: document the public next-turn picker and named action icons.
- Modify `docs/README.md`: index the implementation plan.

---

### Task 1: Add public action icons needed by the compact toolbar

**Files:**

- Modify: `packages/ui-kit/src/components/icons.tsx`
- Modify: `packages/ui-kit/src/components/rendering.test.tsx`
- Modify: `packages/ui-kit/src/index.ts`
- Modify: `packages/ui-kit/package.json` and `pnpm-lock.yaml` only if a missing icon dependency is discovered

**Interfaces:**

- Consumes: existing `Icon`, `IconSize`, and `lucide-react` wrappers.
- Produces: `SendIcon`, `AppendIcon`, and `StopIcon` exported from `@sovereign/ui-kit`, each accepting `{ size?: IconSize }` and rendering decorative SVG content.

- [ ] **Step 1: Write the failing rendering test**

Add to `rendering.test.tsx`:

```tsx
it("renders composer action icons on the shared UI-kit size grid", () => {
  const markup = renderToStaticMarkup(
    <>
      <SendIcon size="sm" />
      <AppendIcon />
      <StopIcon />
    </>,
  );

  expect(markup.match(/<svg/g)).toHaveLength(3);
  expect(markup).toContain('aria-hidden="true"');
  expect(markup).not.toContain("undefined");
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pnpm --filter @sovereign/ui-kit test -- src/components/rendering.test.tsx`

Expected: FAIL because the three named exports do not exist.

- [ ] **Step 3: Implement the minimal wrappers**

Import suitable Lucide symbols (`Send`, `Plus`, `Square`) in `icons.tsx` and expose wrappers through the existing `actionIcon` helper. Do not expose Lucide types or import Lucide from application code.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `pnpm --filter @sovereign/ui-kit test -- src/components/rendering.test.tsx && pnpm --filter @sovereign/ui-kit typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui-kit/src/components/icons.tsx packages/ui-kit/src/components/rendering.test.tsx packages/ui-kit/src/index.ts
git commit -m "feat(ui-kit): add composer action icons"
```

### Task 2: Build the controlled combined model/reasoning picker

**Files:**

- Create: `packages/ui-kit/src/components/next-turn-picker.tsx`
- Create: `packages/ui-kit/src/components/next-turn-picker.module.css`
- Create: `packages/ui-kit/src/components/next-turn-picker.test.tsx`
- Modify: `packages/ui-kit/src/index.ts`
- Modify: `packages/ui-kit/src/i18n/messages/en.ts` and `packages/ui-kit/src/i18n/messages/ru.ts` if new labels are needed

**Interfaces:**

- Consumes: `ModelPickerGroup[]`, current `model`, current `thinkingLevel`, `reasoningSupported`, `thinkingLevels`, `Popover`, the reusable `ModelPickerMenu`, `Tooltip`, and localized labels.
- Produces:

```ts
export type NextTurnPickerProps = {
  model: string;
  modelGroups: ModelPickerGroup[];
  onModelChange: (model: string) => void;
  onExpandModelGroup: (providerId: string) => void;
  thinkingLevel: ThinkingLevel;
  reasoningSupported: boolean;
  onThinkingLevelChange: (level: ThinkingLevel) => void;
  modelLabel: string;
  reasoningLabel: string;
  triggerLabel: string;
  placeholder: string;
  emptyText: string;
  translator: ScopedTranslator;
  disabled?: boolean;
};

export function NextTurnPicker(props: NextTurnPickerProps): React.JSX.Element;
```

The same task also produces this internal/public UI-kit extraction from `model-picker.tsx`, preserving
the existing `ModelPicker` behavior by composing its current trigger/popover around the menu body:

```ts
type ModelPickerMenuProps = {
  groups: ModelPickerGroup[];
  value: string | undefined;
  onChange: (value: string) => void;
  onExpandGroup?: (groupId: string) => void;
  label: string;
  placeholder: string;
  emptyText: string;
  disabled?: boolean;
};

export function ModelPickerMenu(props: ModelPickerMenuProps): React.JSX.Element;
```

`ModelPickerMenu` remains an internal export from `model-picker.tsx`; it is not added to the UI-kit's
top-level index because callers should use `ModelPicker` or `NextTurnPicker` rather than assemble the
provider tree themselves.

- [ ] **Step 1: Write failing interaction tests**

Cover these exact cases in `next-turn-picker.test.tsx`:

```tsx
it("opens one first-level menu with model and reasoning rows", () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: /anthropic\/claude.*средний/i }));
  expect(screen.getByRole("menu", { name: "Параметры следующего турна" })).toBeVisible();
  expect(screen.getByRole("menuitem", { name: /Модель/ })).toBeVisible();
  expect(screen.getByRole("menuitem", { name: /Уровень рассуждений/ })).toBeVisible();
});

it("opens provider-grouped model submenu and preserves lazy expansion callback", () => {
  const onExpand = vi.fn();
  render(<Harness onExpandModelGroup={onExpand} />);
  fireEvent.click(screen.getByRole("button", { name: /anthropic\/claude.*средний/i }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Модель/ }));
  expect(screen.getByRole("tree", { name: "Модель" })).toBeVisible();
  fireEvent.click(screen.getByRole("treeitem", { name: "Google" }).querySelector("div")!);
  expect(onExpand).toHaveBeenCalledWith("google");
});

it("opens reasoning submenu, changes level, and closes the cascade", () => {
  const onChange = vi.fn();
  render(<Harness onThinkingLevelChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: /anthropic\/claude.*средний/i }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Уровень рассуждений/ }));
  fireEvent.click(screen.getByRole("option", { name: "Высокий" }));
  expect(onChange).toHaveBeenCalledWith("high");
  expect(screen.queryByRole("menu", { name: "Параметры следующего турна" })).toBeNull();
});

it("forces off and disables reasoning when the selected model does not support it", () => {
  render(<Harness reasoningSupported={false} thinkingLevel="high" />);
  expect(screen.getByRole("button", { name: /выкл/i })).toHaveAttribute("aria-disabled", "true");
});
```

- [ ] **Step 2: Run the new tests to verify RED**

Run: `pnpm --filter @sovereign/ui-kit test -- src/components/next-turn-picker.test.tsx`

Expected: FAIL because `NextTurnPicker` does not exist.

- [ ] **Step 3: Extract the provider-group menu body from `ModelPicker`**

Move the existing flattened-row calculation, group expansion, active-row keyboard navigation, lazy
group callback, selected-row rendering, and `role="tree"` body into `ModelPickerMenu`. Keep the
existing `ModelPicker` public props and behavior by rendering `ModelPickerMenu` inside its current
`Popover`. Add focused tests proving the old trigger still opens the same grouped tree and that the new
body can render without a second trigger. Do not add a second scrollbar: the existing tree dropdown's
max-height and themed overflow remain the only model-list scrolling surface.

- [ ] **Step 4: Implement the picker with explicit cascade state**

Use one outer `Popover` for the combined trigger and first-level menu. Each first-level row is a
custom `Popover` trigger: the model row opens a sibling nested popover containing `ModelPickerMenu`,
and the reasoning row opens a sibling nested popover containing the existing reasoning options. This
keeps the first level to exactly two rows and avoids rendering a model picker trigger inside the
submenu. Selection closes both the nested popover and the outer popover. `Escape` and pointer-down
outside are handled by the existing popover primitives. Use `aria-haspopup`, `aria-expanded`,
`aria-controls`, `role="menu"`, `role="menuitem"`, and visible current values.

The nested model picker must not wrap the entire composer or impose a scroll on the composer. Its own
existing max-height/overflow remains scoped to the provider tree. Place the nested popover to the side
of its row on wide surfaces and below the parent on narrow surfaces using UI-kit token geometry.

- [ ] **Step 5: Add component styles and public export**

Style only the trigger, menu rows, nested placement, and focus/disabled states with UI-kit tokens. Export from `packages/ui-kit/src/index.ts`.

- [ ] **Step 6: Run focused tests, package typecheck, and format**

Run: `pnpm --filter @sovereign/ui-kit test -- src/components/next-turn-picker.test.tsx && pnpm --filter @sovereign/ui-kit typecheck && pnpm exec prettier --check packages/ui-kit/src/components/next-turn-picker.tsx packages/ui-kit/src/components/next-turn-picker.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/ui-kit/src/components/next-turn-picker.tsx packages/ui-kit/src/components/next-turn-picker.module.css packages/ui-kit/src/components/next-turn-picker.test.tsx packages/ui-kit/src/index.ts packages/ui-kit/src/i18n/messages/en.ts packages/ui-kit/src/i18n/messages/ru.ts
git commit -m "feat(ui-kit): add next-turn cascade picker"
```

### Task 3: Reshape `MessageComposer` around the compact surface

**Files:**

- Modify: `apps/web/src/sessions/message-composer.tsx`
- Modify: `apps/web/src/sessions/message-composer.test.tsx`
- Modify: `apps/web/src/sessions/sessions.css`
- Modify: `apps/web/src/shell/styles.test.ts`
- Modify: `packages/ui-kit/src/i18n/messages/en.ts` and `packages/ui-kit/src/i18n/messages/ru.ts` if action labels are missing

**Interfaces:**

- Consumes: `NextTurnPicker`, `SendIcon`, `AppendIcon`, `StopIcon`, `Button`, `Tooltip`, existing handlers, and existing translator.
- Produces: unchanged `MessageComposerProps` and unchanged `onSubmit`, `onSendMessage`, `onInterrupt`, `onError` behavior.

- [ ] **Step 1: Replace obsolete DOM assertions with failing compact-layout tests**

Update `message-composer.test.tsx` to assert:

```tsx
it("renders one textarea row and one toolbar row inside the raised surface", () => {
  const { container } = render(<ComposerHarness />);
  const composer = container.querySelector(".sessions-composer");
  expect(composer?.querySelector("textarea")).not.toBeNull();
  expect(composer?.querySelector(".sessions-composer-toolbar")).not.toBeNull();
  expect(composer?.querySelectorAll(".sessions-composer-options")).toHaveLength(0);
  expect(composer?.querySelectorAll("button")).toHaveLength(3);
});

it("keeps icon actions named and preserves idle append/send callbacks", async () => {
  const onSendMessage = vi.fn(() => Promise.resolve(undefined));
  render(<ComposerHarness onSendMessage={onSendMessage} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Сообщение агенту" }), {
    target: { value: "добавь" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Дописать без запуска" }));
  expect(onSendMessage).toHaveBeenCalledWith({ text: "добавь", mode: "append" });
});

it("shows the compact combined trigger instead of two visible comboboxes", () => {
  render(<ComposerHarness />);
  expect(screen.getByRole("button", { name: /anthropic\/claude.*средний/i })).toBeVisible();
  expect(screen.queryByRole("combobox", { name: "Модель" })).toBeNull();
  expect(screen.queryByRole("combobox", { name: "Уровень рассуждений" })).toBeNull();
});
```

Keep existing tests for request payloads, rejection/clearing, busy modes, append, and interrupt, changing only selectors from visible text buttons to their accessible names.

- [ ] **Step 2: Run the focused composer tests to verify RED**

Run: `pnpm --filter @sovereign/web test -- src/sessions/message-composer.test.tsx`

Expected: FAIL because the current composer still renders the options grid and text buttons.

- [ ] **Step 3: Implement the two-zone JSX**

Inside the existing `RaisedSurface`, render:

```tsx
<div className="sessions-composer">
  <Textarea ... autoGrow rows={2} maxRows={12} />
  <div className="sessions-composer-toolbar">
    <div className="sessions-composer-future-slot" aria-hidden="true" />
    <div className="sessions-composer-actions">
      {!busy ? <Tooltip content={t("chat.append")}><Button iconOnly aria-label={t("chat.append")}><AppendIcon /></Button></Tooltip> : null}
      <Tooltip content={busy ? t(`chat.mode.${mode}.send`) : t("chat.send")}>
        <Button tone="accent" iconOnly aria-label={busy ? t(`chat.mode.${mode}.send`) : t("chat.send")} onClick={send} disabled={...}><SendIcon /></Button>
      </Tooltip>
      <NextTurnPicker ... />
      {busy ? <Tooltip content={t("chat.stop")}><Button tone="danger" iconOnly aria-label={t("chat.stop")} onClick={onInterrupt}><StopIcon /></Button></Tooltip> : null}
    </div>
  </div>
</div>
```

Keep the busy `SegmentedControl` above the surface unchanged for this slice; the empty future slot is layout reservation only and does not silently move queue semantics.

- [ ] **Step 4: Replace composer CSS and add textarea-only scrollbar rules**

Remove `.sessions-composer-options` and the flex-wrap layout. Add:

```css
.sessions-composer {
  display: grid;
  grid-template-rows: minmax(0, auto) auto;
  gap: var(--sovereign-space-2);
  min-width: 0;
}

.sessions-composer > textarea {
  min-width: 0;
  resize: none;
  scrollbar-width: thin;
  scrollbar-color: var(--sovereign-border-strong) transparent;
}

.sessions-composer > textarea::-webkit-scrollbar {
  width: var(--sovereign-space-2);
}

.sessions-composer > textarea::-webkit-scrollbar-track {
  background: transparent;
}

.sessions-composer > textarea::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: var(--sovereign-radius-pill);
  background: var(--sovereign-border-strong);
  background-clip: padding-box;
}

.sessions-composer-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sovereign-space-2);
  min-width: 0;
}

.sessions-composer-future-slot {
  flex: 1 1 auto;
  min-width: 0;
}

.sessions-composer-actions {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--sovereign-space-1);
  min-width: 0;
}
```

Do not add `overflow` or scrollbar declarations to `.sessions-composer`, `.sessions-composer-surface`, or the popover wrapper. Use only existing UI-kit tokens and leave surface chrome to `RaisedSurface`.

- [ ] **Step 5: Update style-contract tests**

Replace assertions expecting `.sessions-composer { flex-wrap: wrap; }` and the option collapse container with checks for the grid, toolbar, textarea-only scrollbar, and the absence of composer-level overflow/surface visual properties.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `pnpm --filter @sovereign/web test -- src/sessions/message-composer.test.tsx src/sessions/chat-view.test.tsx src/shell/styles.test.ts && pnpm --filter @sovereign/web typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/sessions/message-composer.tsx apps/web/src/sessions/message-composer.test.tsx apps/web/src/sessions/sessions.css apps/web/src/shell/styles.test.ts packages/ui-kit/src/i18n/messages/en.ts packages/ui-kit/src/i18n/messages/ru.ts
git commit -m "feat(web): compact the session composer"
```

### Task 4: Document and verify the final visual contract

**Files:**

- Modify: `docs/ui-kit.md`
- Modify: `docs/README.md`
- Modify: `apps/web/src/sessions/message-composer.test.tsx` or `apps/web/src/sessions/composer-scrollbar.test.ts`
- Modify: `apps/web/src/shell/styles.test.ts` if final selector coverage needs tightening

**Interfaces:**

- Consumes: completed `NextTurnPicker`, compact composer DOM, existing UI-kit tokens.
- Produces: repository documentation and a final focused verification suite for visual invariants.

- [ ] **Step 1: Add final regression assertions**

Add a stylesheet contract test with the exact invariants:

```ts
it("keeps overflow scoped to the textarea", () => {
  const sessions = readFileSync(join(import.meta.dirname, "sessions.css"), "utf8");

  expect(sessions).toMatch(/\.sessions-composer\s*\{[^}]*display:\s*grid;/s);
  expect(sessions).toMatch(/\.sessions-composer\s*>\s*textarea\s*\{[^}]*scrollbar-width:\s*thin;/s);
  expect(sessions).toMatch(/\.sessions-composer\s*>\s*textarea::-webkit-scrollbar-thumb/);
  expect(sessions).not.toMatch(/\.sessions-composer\s*\{[^}]*overflow(?:-y)?\s*:/s);
  expect(sessions).not.toMatch(/\.sessions-composer-surface\s*\{[^}]*overflow(?:-y)?\s*:/s);
});
```

Keep provider-group interaction assertions in `next-turn-picker.test.tsx`, where the concrete
`ModelPickerMenu` roles are available; do not duplicate them as CSS tests.

- [ ] **Step 2: Run the complete relevant suite**

Run:

```bash
pnpm --filter @sovereign/ui-kit test -- src/components/rendering.test.tsx src/components/next-turn-picker.test.tsx
pnpm --filter @sovereign/web test -- src/sessions/message-composer.test.tsx src/sessions/chat-view.test.tsx src/sessions/session-usage.test.tsx src/shell/styles.test.ts
pnpm --filter @sovereign/ui-kit typecheck
pnpm --filter @sovereign/web typecheck
pnpm exec prettier --check packages/ui-kit/src/components/next-turn-picker.tsx packages/ui-kit/src/components/next-turn-picker.test.tsx apps/web/src/sessions/message-composer.tsx apps/web/src/sessions/message-composer.test.tsx apps/web/src/sessions/sessions.css
```

Expected: all commands PASS.

- [ ] **Step 3: Update docs**

In `docs/ui-kit.md`, document the public next-turn picker, named composer icons, provider grouping, cascade placement, and the rule that only the textarea scrolls when its draft reaches twelve rows. Add the plan/spec links to `docs/README.md`.

- [ ] **Step 4: Commit documentation and final verification**

```bash
git add docs/ui-kit.md docs/README.md apps/web/src/sessions/message-composer.test.tsx apps/web/src/shell/styles.test.ts
git commit -m "docs(ui): document compact composer contract"
```

---

## Self-Review Checklist

- [x] Spec coverage: surface, textarea growth/scroll, one-row toolbar, icon actions, combined cascade, provider groups, reasoning fallback, preserved semantics, accessibility, responsive behavior, tests, and docs each map to a task.
- [x] Placeholder scan: no `TBD`, `TODO`, or unspecified implementation branches remain in the tasks.
- [x] Type consistency: `NextTurnPickerProps` names match the existing `MessageComposerProps` fields and all later tasks consume the exported component.
- [x] Scope check: the work stays within the UI-kit picker/icon boundary and the session composer; no protocol or HTTP changes are proposed.
