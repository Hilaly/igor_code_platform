# Sidebar Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the left shell panel into three visually distinct sections with an overflow-safe project tree, hover/focus actions and context cards, plus a compact account footer.

**Architecture:** Reusable pointer and focus mechanics stay in `@sovereign/ui-kit`: `Menu` gains optional hover opening, `Tree` gains optional contextual content and a hidden-until-interaction action rail, and named Lucide wrappers supply icons. The web app only maps `Project` and `Session` snapshots into those generic slots and composes the shell sections; no protocol or daemon changes are required.

**Tech Stack:** React 19, TypeScript, CSS Modules in UI kit, application shell CSS, Vitest, Testing Library, pnpm.

## Global Constraints

- Work only in `/Users/user/repos/sovereign_platform_node/.worktrees/sidebar-polish` on `feat/sidebar-polish`.
- Use existing semantic color roles and spacing tokens; add no color literals or application selectors for UI-kit classes.
- Preserve tree ARIA roles, roving focus, click selection, keyboard expansion, menu Escape behavior, and focus return.
- Hover interactions must have focus/click alternatives and must not become the only way to invoke an action.
- Do not change protocol, daemon routes, project/session operations, or navigation routes.
- Follow strict TDD: each production behavior starts with a test that fails for the missing behavior.

---

### Task 1: Hover-capable compact menus

**Files:**

- Modify: `packages/ui-kit/src/components/menu.tsx`
- Modify: `packages/ui-kit/src/components/menu.module.css`
- Test: `packages/ui-kit/src/components/interactive-components.test.tsx`

**Interfaces:**

- Consumes: existing `MenuProps`, portal positioning, outside-pointer and keyboard behavior.
- Produces: `MenuProps.openOnHover?: boolean`; hover opens the menu, moving between trigger and popup keeps it open, and leaving schedules a short close while click and keyboard behavior remain unchanged.

- [ ] **Step 1: Write the failing hover-menu test**

Add a test that renders:

```tsx
<Menu
  label="Project actions"
  trigger={<MoreIcon />}
  triggerLabel="Open project actions"
  compact
  openOnHover
  items={[{ id: "rename", label: "Rename", onSelect: vi.fn() }]}
/>
```

Use fake timers. Assert that `fireEvent.pointerEnter(trigger)` exposes `role="menu"`, pointer transfer to the menu survives the close delay, and leaving both regions removes it after the delay. Then click the trigger and press `Escape` to prove the existing alternative still works.

- [ ] **Step 2: Run the target test and verify RED**

Run:

```bash
pnpm --filter @sovereign/ui-kit test -- src/components/interactive-components.test.tsx
```

Expected: TypeScript/Vitest fails because `openOnHover` is not a `MenuProps` property or the menu does not open on pointer enter.

- [ ] **Step 3: Implement minimal hover state coordination**

Extend the public props:

```ts
openOnHover?: boolean;
```

Keep a close timer in a ref. Add `openFromPointer`, `schedulePointerClose`, and `cancelPointerClose` helpers. Wire pointer enter/leave on both root and portaled menu, clear the timer on unmount, and leave the current click, outside-pointer, Escape, focus movement, and selection paths intact. Use a single short constant near the component, e.g. `const hoverCloseDelayMilliseconds = 120`.

- [ ] **Step 4: Run the target test and verify GREEN**

Run the same target command. Expected: all interactive component tests pass with no warnings.

- [ ] **Step 5: Commit**

```bash
git add packages/ui-kit/src/components/menu.tsx packages/ui-kit/src/components/menu.module.css packages/ui-kit/src/components/interactive-components.test.tsx
git commit -m "feat(ui-kit): open compact menus on hover"
```

### Task 2: Context-aware overflow-safe tree rows

**Files:**

- Create: `packages/ui-kit/src/components/tree-context-card.tsx`
- Create: `packages/ui-kit/src/components/tree-context-card.module.css`
- Modify: `packages/ui-kit/src/components/tree.tsx`
- Modify: `packages/ui-kit/src/components/tree.module.css`
- Modify: `packages/ui-kit/src/components/rendering.test.tsx`
- Modify: `packages/ui-kit/src/components/interactive-components.test.tsx`
- Modify: `packages/ui-kit/src/components/icons.tsx`
- Modify: `packages/ui-kit/src/index.ts`

**Interfaces:**

- Consumes: `TreeNode.icon`, existing tree selection/expansion/actions, `createPortal`, semantic tokens.
- Produces:
  - `TreeNode.context?: ReactNode`
  - `TreeProps.actionsVisibility?: "always" | "interaction"`
  - exported `TreeContextCard`, `TreeContextCardHeader`, `TreeContextCardFact`, `FolderIcon`, `UserIcon`
  - a context layer anchored to a tree row, opened by hover or focus and kept inside the viewport.

- [ ] **Step 1: Write failing render and interaction tests**

Add a rendering test with a node containing `icon={<FolderIcon />}` and `context={<div>Project facts</div>}`; assert the icon is decorative and the tree item keeps the label-only accessible name.

Add an interaction test rendering `actionsVisibility="interaction"`. Assert the tree root exposes a stable data attribute for the CSS mode, pointer enter on the project treeitem displays `Project facts` in a portaled layer, moving to the layer keeps it visible, pointer leave closes it after fake timers advance, and focusing the treeitem opens the same layer.

- [ ] **Step 2: Run target tests and verify RED**

```bash
pnpm --filter @sovereign/ui-kit test -- src/components/rendering.test.tsx src/components/interactive-components.test.tsx
```

Expected: compile failure for missing props/components.

- [ ] **Step 3: Implement the context card primitives and named icons**

Wrap Lucide `Folder` and `UserRound` through the existing `actionIcon` helper. Implement presentational card primitives using semantic HTML and CSS-module classes only. Export them from `src/index.ts`.

- [ ] **Step 4: Implement tree context behavior and safe row geometry**

In `Tree`, track the active context node and its row rectangle. Render one portal layer for the active node. Coordinate pointer enter/leave and focus/blur with a short close timer, and recompute fixed positioning on resize/scroll.

Change row geometry to:

```css
.item {
  width: 100%;
  min-width: 0;
}
.row {
  width: 100%;
  box-sizing: border-box;
}
```

Use a root data attribute for `actionsVisibility`. In interaction mode, visually hide `.actions` with opacity/pointer-events and reveal it for row hover, node focus-within, or an expanded menu. Keep it in keyboard order so focus makes it visible.

- [ ] **Step 5: Run target tests and verify GREEN**

Run the Task 2 target command. Expected: both files pass with no act warnings.

- [ ] **Step 6: Run UI-kit style discipline tests**

```bash
pnpm --filter @sovereign/ui-kit test -- src/styles/styles.test.ts
```

Expected: no raw colors, unknown tokens, unused module files, or missing component style modules.

- [ ] **Step 7: Commit**

```bash
git add packages/ui-kit/src/components packages/ui-kit/src/index.ts
git commit -m "feat(ui-kit): add contextual tree rows"
```

### Task 3: Project/session content and compact account footer

**Files:**

- Modify: `apps/web/src/sessions/sidebar-projects.tsx`
- Modify: `apps/web/src/sessions/sidebar-projects.test.tsx`
- Modify: `apps/web/src/shell/account-control.tsx`
- Modify: `apps/web/src/shell/account-control.test.tsx`
- Modify: `packages/ui-kit/src/i18n/messages/en.ts`
- Modify: `packages/ui-kit/src/i18n/messages/ru.ts`

**Interfaces:**

- Consumes: Task 1 `Menu.openOnHover`; Task 2 tree context/card/icon exports; existing `Project`, `Session`, translator, and mutation callbacks.
- Produces: folder-led project rows, contextual project/session cards from current snapshots, interaction-only action rails, and an account trigger containing user icon, account label and daemon status.

- [ ] **Step 1: Write failing sidebar content tests**

Extend the sidebar tests to assert:

```ts
expect(screen.getByTestId("project-folder-alpha")).toBeTruthy();
fireEvent.pointerEnter(screen.getByRole("treeitem", { name: "Alpha" }));
expect(screen.getByText("/code/alpha")).toBeTruthy();
expect(screen.getByText("1 active session")).toBeTruthy();

fireEvent.pointerEnter(screen.getByRole("treeitem", { name: "Session A" }));
expect(screen.getByText("Alpha")).toBeTruthy();
expect(screen.getByText(/created/)).toBeTruthy();
```

Also assert that project and session action menu triggers use hover-enabled menus while their current click flows still execute the same callbacks.

- [ ] **Step 2: Write the failing account footer test**

Render `AccountControl` and assert its trigger contains the account label, a decorative user icon, and the status dot; clicking still opens Archive, Settings and Log out.

- [ ] **Step 3: Run web targets and verify RED**

```bash
pnpm --filter @sovereign/web test -- src/sessions/sidebar-projects.test.tsx src/shell/account-control.test.tsx
```

Expected: missing folder/context/account visual assertions fail.

- [ ] **Step 4: Build project and session nodes from existing data**

For each project, supply `FolderIcon`, `TreeContextCard` with active session count and folder, and the existing project action controls. For each session, supply a card with title, project name/path and localized relative created time. Set `actionsVisibility="interaction"` on `Tree` and `openOnHover` on compact action menus. Do not add fetches or mutation paths.

Add exact singular/plural and relative-time translations needed by these cards to both core catalogs.

- [ ] **Step 5: Build the compact account trigger**

Use the existing block `Menu` with a React trigger containing `UserIcon`, account label, and `StatusDot`. Keep `placement="above"` and all current items/callbacks. Remove the now-redundant status sibling from the app component.

- [ ] **Step 6: Run target tests and verify GREEN**

Run the Task 3 target command. Expected: both test files pass and existing mutation/menu tests remain green.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/sessions/sidebar-projects.tsx apps/web/src/sessions/sidebar-projects.test.tsx apps/web/src/shell/account-control.tsx apps/web/src/shell/account-control.test.tsx packages/ui-kit/src/i18n/messages/en.ts packages/ui-kit/src/i18n/messages/ru.ts
git commit -m "feat(web): enrich sidebar project navigation"
```

### Task 4: Three-section shell layout and overflow fix

**Files:**

- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/shell/shell.tsx`
- Modify: `apps/web/src/shell/shell.css`
- Modify: `apps/web/src/shell/shell.test.tsx`
- Modify: `apps/web/src/shell/styles.test.ts`
- Modify: `docs/ui-kit.md`
- Modify: `docs/README.md`
- Create: `docs/superpowers/plans/2026-08-06-sidebar-polish.md` (this file)

**Interfaces:**

- Consumes: Task 3 `SidebarProjects` and `AccountControl`.
- Produces: shell header/navigation/footer slots that visually read as three sections; a vertically scrolling project region with no horizontal scroll; current resizer and stable-subtree behavior unchanged.

- [ ] **Step 1: Write failing shell structure and style tests**

Update the shell fixture and assertions to require:

```ts
expect(screen.getByTestId("shell-left-header")).toBeTruthy();
expect(screen.getByTestId("shell-left-projects")).toBeTruthy();
expect(screen.getByTestId("shell-left-footer")).toBeTruthy();
```

Extend the static style test to require `overflow-x: hidden` on the left panel/project scroller and `min-width: 0` on the navigation and project section.

- [ ] **Step 2: Run shell targets and verify RED**

```bash
pnpm --filter @sovereign/web test -- src/shell/shell.test.tsx src/shell/styles.test.ts
```

Expected: structural hooks and overflow declarations are absent.

- [ ] **Step 3: Implement the three-section composition**

Change `ShellProps` from a monolithic `navigation` slot to explicit `navigationHeader` and `navigation` body slots while keeping `status` as footer. In `App.tsx`, place brand and New Session in the header and the project tree in the body.

Give the header a dedicated gap and bottom spacing. Make the body `min-width: 0; min-height: 0; overflow: hidden auto;` and the outer panel `overflow: hidden;`. Keep the footer fixed with its separator. Ensure all direct flex/grid children use `min-width: 0`.

- [ ] **Step 4: Run shell targets and verify GREEN**

Run the Task 4 target command. Expected: shell tests and static style discipline pass.

- [ ] **Step 5: Update durable UI documentation**

Update `docs/ui-kit.md` sidebar description to record interaction-only row actions, context cards, section composition, and the overflow rule. Keep `docs/README.md` entries synchronized with this plan.

- [ ] **Step 6: Run formatter on changed files**

```bash
pnpm exec prettier --write packages/ui-kit/src/components packages/ui-kit/src/i18n/messages apps/web/src/sessions apps/web/src/shell apps/web/src/App.tsx docs/ui-kit.md docs/README.md docs/superpowers
```

Expected: files are formatted without unrelated rewrites outside the named paths.

- [ ] **Step 7: Run full verification**

```bash
make typecheck
make lint
make fmt-check
pnpm --filter @sovereign/ui-kit test
pnpm --filter @sovereign/web test
make build
```

Expected: every command exits 0, UI kit reports at least 176 passing tests plus additions, web reports at least 609 passing tests plus additions, and Vite creates the production assets without warnings introduced by this change.

- [ ] **Step 8: Perform browser visual verification**

Run the web app with its normal development command and inspect the sidebar at minimum width and a widened panel. Verify:

- no horizontal scrollbar;
- header/project/footer separation;
- folder alignment and session indentation;
- action buttons hidden at rest and visible on hover/focus;
- project/session cards remain inside the viewport;
- action menus remain open while crossing from trigger to popup;
- compact footer menu opens upward.

Capture screenshots for the worktree if the runbook permits a deterministic local state; otherwise report the exact missing runtime state.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src docs packages/ui-kit/src
git commit -m "fix(web): polish sidebar layout"
```
