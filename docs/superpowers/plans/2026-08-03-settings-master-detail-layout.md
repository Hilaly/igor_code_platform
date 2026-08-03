# Settings Master–Detail Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn settings into a URL-driven master–detail view inside the central page and temporarily remove the shell's right panel while settings are open.

**Architecture:** Make the settings section required in the router so the URL is the only selection source, then render `SettingsView` as one CSS-separated navigation/content surface. Add a presentational `rightUnavailable` input to `Shell`; `App` derives it from the current page without mutating the persisted `ShellLayout`.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, CSS, pnpm workspace.

## Global Constraints

- Work only in `/Users/user/repos/sovereign_platform_node/.worktrees/settings-master-detail-layout` on `feat/settings-master-detail-layout`.
- Keep the global left panel and the existing five settings sections.
- Keep settings section content, APIs, controller state, provider detail routes, the UI-kit visual language, other page layouts, and the persisted `ShellLayout` format unchanged.
- Add no dependency and no new reusable UI-kit primitive.
- Use test-first red/green cycles and atomic Conventional Commits in English.
- Finish with web tests, `make check`, `make build`, and an independent reviewer subagent.

---

## File Map

- `apps/web/src/router.ts`: require a settings section and canonicalize bare `/settings` to appearance.
- `apps/web/src/router.test.ts`: pure parsing/formatting expectations for the default settings route.
- `apps/web/src/router-navigation.test.ts`: browser-history proof that bare `/settings` is replaced without an extra entry.
- `apps/web/src/settings/settings-view.tsx`: render the five-section navigation and the active section content on one surface.
- `apps/web/src/settings/settings-view.test.tsx`: selected state, active-content, and navigation behavior.
- `apps/web/src/settings/settings.css`: two-column geometry, independent scrolling, and narrow-container horizontal navigation.
- `apps/web/src/shell/shell.tsx`: presentational suppression of the right panel without layout mutation.
- `apps/web/src/shell/shell.test.tsx`: DOM behavior for temporary unavailability and restoration from the same layout.
- `apps/web/src/shell/styles.test.ts`: application CSS contract for settings sizing and responsive geometry.
- `apps/web/src/App.tsx`: derive the settings section and right-panel availability from `page`.
- `docs/ui-kit.md`: record the current settings-shell composition and rejected alternatives in its existing “Почему так” section.
- `docs/README.md`: index this implementation plan.

### Task 1: Canonical settings route

**Files:**

- Modify: `apps/web/src/router.ts`
- Modify: `apps/web/src/router.test.ts`
- Modify: `apps/web/src/router-navigation.test.ts`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**

- Produces: `Page` settings variant `{ kind: "settings"; section: SettingsSection; providerId?: string }`.
- Produces: `matchPage("/settings")` as the appearance section and `pathOf(...)` as `/settings/appearance`.
- Consumes later: `SettingsView.section: SettingsSection` and `page.kind === "settings"` for shell composition.

- [ ] **Step 1: Write failing pure and browser-route tests**

Change the existing settings test to require the default section and the round-trip table to require its canonical path:

```ts
it("takes bare settings for appearance", () => {
  expect(matchPage("/settings")).toEqual({ kind: "settings", section: "appearance" });
  expect(pathOf(matchPage("/settings"))).toBe("/settings/appearance");
});
```

Add the legacy/canonical browser tuple:

```ts
["/settings", "/settings/appearance", { kind: "settings", section: "appearance" }],
```

- [ ] **Step 2: Run focused router tests and verify RED**

Run: `pnpm --filter @sovereign/web test -- router.test.ts router-navigation.test.ts`

Expected: FAIL because bare settings still has no `section` and is not replaced.

- [ ] **Step 3: Implement the required settings route**

Use this required page variant and default branch:

```ts
| { kind: "settings"; section: SettingsSection; providerId?: string }

if (section === undefined) {
  return { kind: "settings", section: "appearance" };
}
```

Remove the undefined branch in `pathOf`. In `App`, navigate the account action to
`{ kind: "settings", section: "appearance" }` and pass `page.section` only from a settings page.

- [ ] **Step 4: Run focused tests and typecheck, verify GREEN**

Run: `pnpm --filter @sovereign/web test -- router.test.ts router-navigation.test.ts && pnpm --filter @sovereign/web typecheck`

Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Commit the canonical route**

```bash
git add apps/web/src/router.ts apps/web/src/router.test.ts apps/web/src/router-navigation.test.ts apps/web/src/App.tsx
git commit -m "refactor(web): canonicalize settings section routes"
```

### Task 2: One-surface settings master–detail view

**Files:**

- Modify: `apps/web/src/settings/settings-view.tsx`
- Modify: `apps/web/src/settings/settings-view.test.tsx`
- Modify: `apps/web/src/settings/settings.css`
- Modify: `apps/web/src/shell/styles.test.ts`

**Interfaces:**

- Consumes: required `section: SettingsSection`, five existing React section nodes, and `onSectionChange(section)`.
- Produces: one `nav` named “Разделы настроек”, one active heading, one selected `ListRow`, and one active content node.

- [ ] **Step 1: Write failing component behavior tests**

Render the view with unique text for all five content nodes, then assert real DOM behavior:

```tsx
expect(screen.getByRole("navigation", { name: "Разделы настроек" })).toBeTruthy();
expect(screen.getByRole("heading", { name: "Провайдеры" })).toBeTruthy();
expect(screen.getByRole("button", { name: "Провайдеры" }).getAttribute("aria-current")).toBe(
  "true",
);
expect(screen.getByText("provider content")).toBeTruthy();
expect(screen.queryByText("appearance content")).toBeNull();

fireEvent.click(screen.getByRole("button", { name: "Плагины" }));
expect(onSectionChange).toHaveBeenCalledWith("plugins");
```

- [ ] **Step 2: Run the focused component test and verify RED**

Run: `pnpm --filter @sovereign/web test -- settings-view.test.tsx`

Expected: FAIL because the current view duplicates headings inside two `Panel` components and still accepts an undefined section.

- [ ] **Step 3: Implement the semantic one-surface markup**

Remove `Panel`, make `section` required, and use this structure:

```tsx
<div className="settings">
  <aside className="settings-sidebar">
    <Heading level={1}>{t("settings.title")}</Heading>
    <nav className="settings-nav" aria-label={t("settings.sections")}>
      <List>{/* the five selected ListRow buttons */}</List>
    </nav>
  </aside>
  <section className="settings-content" aria-labelledby="settings-active-heading">
    <Heading level={1} id="settings-active-heading">
      {t(`settings.section.${section}`)}
    </Heading>
    <div className="settings-content-body">{content}</div>
  </section>
</div>
```

Keep the current closed mapping from section to content; do not introduce a registry abstraction.

- [ ] **Step 4: Add the responsive CSS geometry**

Use `.settings` as a two-column grid with `container-type: inline-size`, remove the old
`.settings-split` rules, put the vertical border and scrolling on `.settings-sidebar`, and put
vertical scrolling on `.settings-content-body`. Under `@container (width < 40rem)`, switch the grid
to one column, replace the sidebar's inline border with a block-end border, and make the list inside
`.settings-nav` a horizontal, non-wrapping row with `overflow-x: auto`.

- [ ] **Step 5: Extend the application layout contract and run focused verification**

Extend the existing layout assertion with behavior-critical settings rules:

```ts
expect(settings).toMatch(/\.settings\s*\{[^}]*grid-template-columns:[^;}]+;/s);
expect(settings).toMatch(/\.settings-content-body\s*\{[^}]*overflow-y:\s*auto;/s);
expect(settings).toMatch(/@container\s*\(width\s*<\s*40rem\)/);
```

Run: `pnpm --filter @sovereign/web test -- settings-view.test.tsx styles.test.ts`

Expected: PASS with the component behavior and sizing contract protected.

- [ ] **Step 6: Commit the settings view**

```bash
git add apps/web/src/settings/settings-view.tsx apps/web/src/settings/settings-view.test.tsx apps/web/src/settings/settings.css apps/web/src/shell/styles.test.ts
git commit -m "feat(web): add settings master detail layout"
```

### Task 3: Temporarily suppress the shell right panel

**Files:**

- Modify: `apps/web/src/shell/shell.tsx`
- Modify: `apps/web/src/shell/shell.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `docs/ui-kit.md`
- Modify: `docs/README.md`

**Interfaces:**

- Produces: optional `ShellProps.rightUnavailable?: boolean`, defaulting to `false`.
- Consumes: `page.kind === "settings"` from `App`.
- Preserves: the exact incoming `ShellLayout`; suppression never calls `onLayoutChange`.

- [ ] **Step 1: Write failing right-panel behavior tests**

Add a test with the visible layout and a real tab:

```tsx
it("temporarily removes the unavailable right panel without changing its layout", () => {
  const { onLayoutChange } = show({
    layout: rightVisible,
    rightUnavailable: true,
    tabs: [{ id: "appearance", label: "Вид", content: <div>вид</div> }],
  });

  expect(screen.queryByRole("complementary", { name: "правая панель" })).toBeNull();
  expect(screen.queryByRole("separator", { name: "правая панель" })).toBeNull();
  expect(screen.queryByRole("button", { name: "показать правую" })).toBeNull();
  expect(onLayoutChange).not.toHaveBeenCalled();
});
```

Add a rerender assertion that removes `rightUnavailable` while keeping `rightVisible`, then sees the
same complementary region and its selected tab content.

- [ ] **Step 2: Run the focused shell test and verify RED**

Run: `pnpm --filter @sovereign/web test -- shell.test.tsx`

Expected: FAIL because `ShellProps` has no `rightUnavailable` contract and the right panel remains.

- [ ] **Step 3: Implement presentational suppression and App integration**

Add `rightUnavailable = false`, derive:

```ts
const rightVisible = !rightUnavailable && !layout.rightHidden;
```

Use `rightVisible` consistently for the right panel, separator, and restore button. Do not call
`onLayoutChange` from this branch. Pass `rightUnavailable={page.kind === "settings"}` from `App`.

- [ ] **Step 4: Run focused and complete web verification**

Run: `pnpm --filter @sovereign/web test -- shell.test.tsx settings-view.test.tsx router.test.ts router-navigation.test.ts && pnpm --filter @sovereign/web typecheck && pnpm --filter @sovereign/web build`

Expected: PASS with no warnings introduced by this change.

- [ ] **Step 5: Update durable documentation**

In `docs/ui-kit.md`, describe the settings-local navigation, canonical section address, and
presentational right-panel suppression in the current shell section. In its existing “Почему так”
section, record why a full-screen settings shell, nested `Panel` cards, and mutating `ShellLayout`
were rejected. Add this plan to `docs/README.md` next to the design.

- [ ] **Step 6: Run the complete repository verification**

Run: `make check && make build`

Expected: both commands exit 0; typecheck, ESLint, Prettier, all tests, and every workspace build
complete without new warnings.

- [ ] **Step 7: Commit integration and documentation**

```bash
git add apps/web/src/App.tsx apps/web/src/shell/shell.tsx apps/web/src/shell/shell.test.tsx docs/ui-kit.md docs/README.md docs/superpowers/plans/2026-08-03-settings-master-detail-layout.md
git commit -m "feat(web): focus shell on settings"
```

### Task 4: Independent review and handoff

**Files:**

- Review: all changes from `df1cf147f97643f960af2f17ef1239ea8d39f867` through `HEAD`.
- Modify only files named by reviewer findings that are accepted after local verification.

**Interfaces:**

- Consumes: the approved design, this plan, commits, and fresh verification output.
- Produces: an independent requirements/code-quality verdict with every Critical or Important finding resolved.

- [ ] **Step 1: Dispatch the required reviewer subagent**

Use `superpowers:requesting-code-review` with:

```text
DESCRIPTION: URL-driven master–detail settings view with presentational right-panel suppression.
PLAN_OR_REQUIREMENTS: docs/superpowers/specs/2026-08-03-settings-master-detail-layout-design.md and docs/superpowers/plans/2026-08-03-settings-master-detail-layout.md
BASE_SHA: df1cf147f97643f960af2f17ef1239ea8d39f867
HEAD_SHA: $(git rev-parse HEAD)
```

- [ ] **Step 2: Verify every finding against the code and tests**

For each finding, reproduce or demonstrate it locally. Fix Critical and Important issues through a
new failing test followed by minimal production changes. Record rejected findings in the final
handoff with concrete technical evidence.

- [ ] **Step 3: Re-run fresh final verification**

Run: `make check && make build && git diff --check && git status --short --branch`

Expected: commands exit 0, the worktree is clean except for an intentional review-fix commit in
progress, and the branch contains only scoped commits.

- [ ] **Step 4: Commit accepted review fixes if any**

```bash
git add <reviewed-files>
git commit -m "fix(web): address settings layout review"
```

Omit this commit when the reviewer reports no accepted issue.
