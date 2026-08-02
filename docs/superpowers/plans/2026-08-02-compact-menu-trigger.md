# Compact Menu Trigger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an explicit lightweight `Menu` trigger mode and use it for every ellipsis context menu in the web application.

**Architecture:** Keep `Menu`'s interaction and accessibility behavior unchanged while adding a CSS-module modifier selected by an explicit `compact` prop. Update only call sites whose trigger is the ellipsis; full-width and labeled account menus retain their existing treatment.

**Tech Stack:** React 19, TypeScript, CSS Modules, Vitest, Testing Library, pnpm workspace.

## Global Constraints

- UI-kit and web styles may use only semantic CSS roles and scale tokens.
- `Menu` must keep its current focus management, keyboard navigation, and ARIA contract.
- New behavior follows TDD: failing test first, then minimal implementation, then full verification.
- Changes are isolated in `/Users/user/repos/sovereign_platform_node/.worktrees/compact-menu` on `feat/compact-menu-trigger`.

### Task 1: Add the compact prop contract and rendering test

**Files:**
- Modify: `packages/ui-kit/src/components/menu.tsx`
- Modify: `packages/ui-kit/src/components/rendering.test.tsx`

**Interfaces:**
- `MenuProps.compact?: boolean`, default `false`.
- Compact state adds `styles.compact` to the trigger class list and does not change menu behavior.

- [ ] **Step 1: Write the failing test**

Add a rendering test beside the existing menu tests:

```tsx
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

  expect(markup).toMatch(/class="[^\"]*trigger[^\"]*compact[^\"]*"/);
  expect(markup).toContain('aria-label="Действия проекта"');
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run `pnpm --filter @sovereign/ui-kit test -- src/components/rendering.test.tsx -t "marks a menu trigger compact"`.
Expected: FAIL because `Menu` does not yet accept `compact` or emit its class.

- [ ] **Step 3: Implement the minimal prop wiring**

Destructure `compact = false` in `Menu`, append `styles.compact` to the trigger class only when true,
and pass the prop through the type. Leave root/block/menu class behavior untouched.

- [ ] **Step 4: Run the focused test and verify it passes**

Run the same focused command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui-kit/src/components/menu.tsx packages/ui-kit/src/components/rendering.test.tsx
git commit -m "feat(ui-kit): add compact menu trigger mode"
```

### Task 2: Style the compact trigger

**Files:**
- Modify: `packages/ui-kit/src/components/menu.module.css`

**Interfaces:**
- `styles.compact` is a trigger-only CSS-module modifier.

- [ ] **Step 1: Write the failing style assertion**

Extend the UI-kit style test to assert that `menu.module.css` contains the compact modifier and tokenized
hover/focus rules. The existing stylesheet token scanner remains the source of truth for allowed values.

- [ ] **Step 2: Run the focused style test and verify it fails**

Run `pnpm --filter @sovereign/ui-kit test -- src/styles/styles.test.ts`.
Expected: FAIL because no compact selector exists.

- [ ] **Step 3: Implement tokenized CSS**

Add a `.compact` modifier for the trigger with no border/background in its resting state, compact control
height and spacing, then add hover and `[aria-expanded="true"]` surface treatments plus a visible
`:focus-visible` ring. Use only existing roles (`--sovereign-fill-surface`, `--sovereign-control-surface-hover`,
`--sovereign-focus-ring`, `--sovereign-accent-surface`) and scale tokens.

- [ ] **Step 4: Run style and UI-kit tests**

Run `pnpm --filter @sovereign/ui-kit test`. Expected: all existing tests and the new style assertion pass.

- [ ] **Step 5: Commit**

```bash
git add packages/ui-kit/src/components/menu.module.css
git commit -m "style(ui-kit): make compact menu triggers lightweight"
```

### Task 3: Apply compact mode to every ellipsis context menu

**Files:**
- Modify: `apps/web/src/projects/projects-view.tsx`
- Modify: `apps/web/src/sessions/sessions-view.tsx`
- Search: `apps/web/src packages/ui-kit/src` for `trigger="…"` and update every context-menu call site.

**Interfaces:**
- Every `Menu` with the ellipsis trigger passes `compact`.
- Labeled menus such as the shell Account menu remain unchanged.

- [ ] **Step 1: Add a web regression assertion**

In the existing Projects and Sessions view tests, render a project/session with actions and assert its
ellipsis trigger carries the compact CSS-module class. Keep assertions semantic: action menu remains named
for assistive technology and still opens its menu items.

- [ ] **Step 2: Run focused web tests and verify the new assertions fail**

Run `pnpm --filter web test -- src/projects/projects-view.test.tsx src/sessions/sessions-view.test.tsx`.
Expected: FAIL because call sites do not pass `compact`.

- [ ] **Step 3: Update the call sites**

Add `compact` to each ellipsis `Menu` invocation found by the search. Do not alter Account or other
full-label menus.

- [ ] **Step 4: Run focused web tests**

Run the same focused command. Expected: PASS, including existing action, dialog, and accessibility tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/projects/projects-view.tsx apps/web/src/sessions/sessions-view.tsx apps/web/src/**/*.test.tsx
git commit -m "style(web): use compact triggers for context menus"
```

### Task 4: Full verification and documentation

**Files:**
- Modify: `docs/ui-kit.md` (document the new optional `compact` prop in the Menu catalog entry)

- [ ] **Step 1: Update the UI-kit catalog documentation**

Describe `compact` as the explicit lightweight trigger mode for context actions and state that it does not
change keyboard or ARIA behavior.

- [ ] **Step 2: Run formatting, lint, typecheck, and all tests**

Run:

```bash
pnpm prettier --check packages/ui-kit/src/components/menu.tsx packages/ui-kit/src/components/menu.module.css packages/ui-kit/src/components/rendering.test.tsx apps/web/src/projects/projects-view.tsx apps/web/src/sessions/sessions-view.tsx docs/ui-kit.md
pnpm lint
pnpm -r typecheck
pnpm -r test
```

Expected: all commands exit 0 with no new warnings or failures.

- [ ] **Step 3: Commit documentation**

```bash
git add docs/ui-kit.md
git commit -m "docs(ui-kit): describe compact menu triggers"
```

- [ ] **Step 4: Inspect final diff and status**

Run `git diff main...HEAD --stat && git status --short --branch` and confirm only the planned files are
changed and the worktree is clean.
