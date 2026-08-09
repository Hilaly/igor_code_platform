# Settings Entity Row Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared UI-kit `SettingsEntityRow` and use it for clickable plugin and project rows while keeping right-side controls independent.

**Architecture:** `SettingsEntityRow` composes the existing `SettingsRow`; it owns only the repeated left-copy/right-slot composition and delegates row geometry, typography, tokens, focus, and responsive behavior to `SettingsRow`. Web feature views supply entity-specific content and callbacks, with no new visual frame or local row geometry.

**Tech Stack:** React 19, TypeScript, CSS Modules, Testing Library, Vitest, pnpm workspace.

## Global Constraints

- Keep all row geometry and visual states in `@sovereign/ui-kit`.
- Use existing UI-kit typography, `Badge`, `Toggle`, `Menu`, and control tokens without local overrides.
- The row click opens detail; right-side controls perform their own actions and never open detail.
- Preserve existing Projects and Plugins data flow, translations, menus, dialogs, and route callbacks.
- Work only in `/Users/user/repos/sovereign_platform_node/.worktrees/settings-entity-row` on `feat/settings-entity-row`.

### Task 1: Add and test the UI-kit component

**Files:**

- Modify: `packages/ui-kit/src/components/settings-frame.tsx`
- Modify: `packages/ui-kit/src/components/rendering.test.tsx`
- Modify: `packages/ui-kit/src/components/interactive-components.test.tsx`
- Modify: `packages/ui-kit/src/components/settings-frame.module.css` only if a slot wrapper needs a token-based layout
- Modify: `packages/ui-kit/src/index.ts` only if the existing settings-frame export does not expose the new symbol

**Interfaces:**

- Produces `SettingsEntityRowProps` and `SettingsEntityRow` from `@sovereign/ui-kit`:

```ts
type SettingsEntityRowProps = {
  label: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  onSelect: () => void;
  selectLabel: string;
};
```

- `SettingsEntityRow` renders `SettingsRow` with `onSelect`/`selectLabel`; its right control is a
  compact flex column containing optional `meta` and `actions`.

- [ ] **Step 1: Write the failing render test**

Add a `SettingsEntityRow` import and a test in `rendering.test.tsx` that renders label, description,
meta, and actions, then asserts the group, visible content, and accessible full-row select button.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @sovereign/ui-kit test -- components/rendering.test.tsx
```

Expected: FAIL because `SettingsEntityRow` is not exported/implemented.

- [ ] **Step 3: Write the failing interaction test**

In `interactive-components.test.tsx`, render the component with `onSelect` and a real UI-kit
`Button` action. Click the full-row select button and assert `onSelect` once; click the action button
and assert the action runs while `onSelect` remains at one call.

- [ ] **Step 4: Run the focused interaction test and verify RED**

Run:

```bash
pnpm --filter @sovereign/ui-kit test -- components/interactive-components.test.tsx
```

Expected: FAIL for the missing component.

- [ ] **Step 5: Implement the minimal component**

Add the public props type and component to `settings-frame.tsx`. Render the right slot as the existing
`SettingsRow` child, using a UI-kit CSS-module wrapper only for vertical grouping of `meta` and
`actions`; do not add colors, fonts, borders, shadows, or bespoke control styles.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run both focused commands above. Expected: PASS with no warnings.

- [ ] **Step 7: Commit the UI-kit slice**

```bash
git add packages/ui-kit/src/components/settings-frame.tsx packages/ui-kit/src/components/settings-frame.module.css packages/ui-kit/src/components/rendering.test.tsx packages/ui-kit/src/components/interactive-components.test.tsx packages/ui-kit/src/index.ts
git commit -m "feat(ui-kit): add clickable settings entity row"
```

### Task 2: Migrate plugin rows

**Files:**

- Modify: `apps/web/src/plugins/plugins-view.tsx`
- Modify: `apps/web/src/settings/settings.css` only to remove geometry duplicated by `SettingsEntityRow`
- Modify: `apps/web/src/plugins/plugins-view.test.tsx`
- Modify: `apps/web/src/shell/styles.test.ts` if its CSS contract names need updating

**Interfaces:**

- Consumes `SettingsEntityRow` from Task 1.
- Keeps `PluginRow` callbacks unchanged: `onOpen(status.key)` for row selection and `onSwitch` for
  the toggle.

- [ ] **Step 1: Add a failing source contract for the shared plugin row**

In `shell/styles.test.ts`, read `plugins-view.tsx` and assert that it imports/uses
`SettingsEntityRow` and no longer renders `SettingsRow` for `PluginRow`. Keep the existing
`plugins-view.test.tsx` assertions for state, contribution count, toggle behavior, and detail opening.

- [ ] **Step 2: Run the plugin test and verify the migration test fails if the implementation is not updated**

```bash
pnpm --filter @sovereign/web test -- plugins/plugins-view.test.tsx
```

Expected: FAIL because `plugins-view.tsx` still uses `SettingsRow` directly.

- [ ] **Step 3: Replace the plugin row wrapper**

Pass plugin name/key as `label`/`description`, lifecycle badge and contribution count as `meta`, and
the existing toggle as `actions`. Preserve the existing accessible name and translation keys.

- [ ] **Step 4: Remove only redundant plugin row geometry**

Delete CSS that duplicates row layout; retain the compact metadata grouping needed inside the slots
and the existing notice/detail styles. Keep all visual values as UI-kit tokens.

- [ ] **Step 5: Run plugin tests and CSS tests**

```bash
pnpm --filter @sovereign/web test -- plugins/plugins-view.test.tsx shell/styles.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the plugin migration**

```bash
git add apps/web/src/plugins/plugins-view.tsx apps/web/src/plugins/plugins-view.test.tsx apps/web/src/settings/settings.css apps/web/src/shell/styles.test.ts
git commit -m "refactor(plugins): use shared settings entity row"
```

### Task 3: Migrate project rows

**Files:**

- Modify: `apps/web/src/projects/projects-view.tsx`
- Modify: `apps/web/src/projects/projects.css` only to remove duplicated row geometry and preserve path tooltip behavior
- Modify: `apps/web/src/projects/projects-view.test.tsx`
- Modify: `apps/web/src/projects/styles.test.ts`

**Interfaces:**

- Consumes `SettingsEntityRow` from Task 1.
- Keeps `ProjectRow` actions and dialogs unchanged.

- [ ] **Step 1: Add the project shared-row source contract and interaction assertions**

In `projects/styles.test.ts`, assert that `projects-view.tsx` imports/uses `SettingsEntityRow` and no
longer imports/uses `ListRow`. In `projects-view.test.tsx`, assert that clicking the project row's
accessible select target calls `onOpen(project.id)`, while opening and using the project action menu
does not call `onOpen`.

- [ ] **Step 2: Run the focused project test and verify RED**

```bash
pnpm --filter @sovereign/web test -- projects/projects-view.test.tsx
```

Expected: FAIL because Projects still render `ListRow`.

- [ ] **Step 3: Replace `ListRow` with `SettingsEntityRow`**

Put project name and shortened folder path in `label`/`description`; put availability, ephemeral,
and conflict badges in `meta`; put `ProjectMenu` in `actions`. Preserve the full-folder tooltip and
all existing callback behavior.

- [ ] **Step 4: Remove project-specific row geometry**

Remove `.projects-row` layout rules that duplicate the UI-kit row. Retain only content-level rules
required for shortened paths, tooltip reveal, badge grouping, and narrow content wrapping.

- [ ] **Step 5: Run project tests and style tests**

```bash
pnpm --filter @sovereign/web test -- projects/projects-view.test.tsx projects/styles.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the project migration**

```bash
git add apps/web/src/projects/projects-view.tsx apps/web/src/projects/projects.css apps/web/src/projects/projects-view.test.tsx apps/web/src/projects/styles.test.ts
git commit -m "refactor(projects): use shared settings entity row"
```

### Task 4: Full verification and documentation alignment

**Files:**

- Modify: `docs/ui-kit.md` if the public component catalog needs the new `SettingsEntityRow` entry
- Modify: `docs/superpowers/specs/2026-08-09-settings-entity-row-design.md` only if implementation reveals a contract correction
- Modify: `docs/README.md` only if the final document title/path changes

- [ ] **Step 1: Add the public UI-kit catalog entry**

Document `SettingsEntityRow` beside `SettingsRow`, including the slot contract and independent action
behavior, if `docs/ui-kit.md` does not already list it.

- [ ] **Step 2: Run all relevant tests**

```bash
pnpm --filter @sovereign/ui-kit test
pnpm --filter @sovereign/web test
```

Expected: both packages PASS.

- [ ] **Step 3: Run typechecks, lint, formatting, and builds**

```bash
pnpm --filter @sovereign/ui-kit typecheck
pnpm --filter @sovereign/web typecheck
pnpm exec eslint packages/ui-kit apps/web
pnpm exec prettier --check packages/ui-kit apps/web docs/ui-kit.md docs/superpowers/specs/2026-08-09-settings-entity-row-design.md
pnpm --filter @sovereign/ui-kit build
pnpm --filter @sovereign/web build
```

If a package has no `build` script, use its declared production/build command and record that fact in
the final report rather than inventing a script.

- [ ] **Step 4: Review the final diff for visual-standard violations**

Confirm no local font-family, hard-coded colors, badge recreation, toggle recreation, row borders,
shadows, or card frames were added. Confirm all interactive controls remain independently clickable.

- [ ] **Step 5: Commit final docs and verification-aligned changes**

```bash
git add docs/ui-kit.md docs/superpowers/specs/2026-08-09-settings-entity-row-design.md docs/README.md
git commit -m "docs(ui): catalog settings entity row"
```
