# Mockup-Aligned Settings UI Kit View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one UI-kit-owned Settings view matching the approved mockup and use it for every settings list and detail, including Projects.

**Architecture:** `@sovereign/ui-kit` owns the frame, local navigation, page heading, and property-row geometry through dedicated Settings components. `apps/web` supplies routes, translated labels, domain content, and actions while removing duplicate page chrome from each embedded view.

**Tech Stack:** React 19, TypeScript, CSS Modules, Vitest, Testing Library, Vite, pnpm.

## Global Constraints

- Work only in `.worktrees/settings-plugin-detail` on `feat/settings-plugin-detail`.
- The approved mockup is the source of truth for density, proportions, typography, and selected states.
- UI-kit owns shared Settings geometry; application CSS owns domain-specific content only.
- Projects list and detail are ordinary nested Settings views at `/settings/projects` and `/settings/projects/:projectId`.
- Every page has exactly one `h1`; local navigation remains visible on detail routes.
- Use only UI-kit tokens for visual values and add no dependency.

---

### Task 1: Public Settings view primitives

**Files:**
- Replace: `packages/ui-kit/src/components/settings-frame.tsx`
- Replace: `packages/ui-kit/src/components/settings-frame.module.css`
- Modify: `packages/ui-kit/src/components/rendering.test.tsx`
- Modify: `packages/ui-kit/src/styles/styles.test.ts`
- Modify: `packages/ui-kit/src/index.ts`

**Interfaces:**
- Produces: `SettingsView`, `SettingsNavigationItem`, `SettingsPage`, and `SettingsRow` React components.
- `SettingsView` consumes `context`, `navigationLabel`, `navigation`, and `children`.
- `SettingsNavigationItem` consumes `selected`, `onSelect`, and `children` and exposes `aria-current="page"` when selected.
- `SettingsPage` consumes `title`, optional `description`, and `children` and owns the only `h1`.
- `SettingsRow` consumes `label`, optional `description`, and `children`.

- [ ] **Step 1: Write failing render tests** asserting the compact context bar, semantic navigation item, single page heading, description, and row label/control regions.
- [ ] **Step 2: Run `pnpm --filter @sovereign/ui-kit test -- rendering.test.tsx`** and verify failure because the new public components do not exist.
- [ ] **Step 3: Write failing CSS contract tests** for a `12rem` navigation column, accent-surface selected row, display serif page heading, row grid, and container-query collapse.
- [ ] **Step 4: Run `pnpm --filter @sovereign/ui-kit test -- styles.test.ts`** and verify failure on the absent Settings contracts.
- [ ] **Step 5: Implement the four components and token-only CSS** with no Breadcrumbs, generic ListRow, or application class names.
- [ ] **Step 6: Run both focused test files and UI-kit typecheck** and verify green output.
- [ ] **Step 7: Commit** with `feat(ui-kit): add mockup-aligned settings view`.

### Task 2: Web Settings compositor

**Files:**
- Modify: `apps/web/src/settings/settings-view.tsx`
- Modify: `apps/web/src/settings/settings-view.test.tsx`
- Modify: `apps/web/src/settings/settings.css`
- Modify: `apps/web/src/shell/styles.test.ts`

**Interfaces:**
- Consumes: all four Settings primitives from Task 1.
- Produces: one compact context title (`Settings`), six UI-kit navigation items, and one `SettingsPage` for the active domain view.

- [ ] **Step 1: Replace component expectations** with tests for compact `Settings` context, six selected-capable navigation items, one h1, and absence of `Sovereign · Settings` breadcrumbs.
- [ ] **Step 2: Run `pnpm --filter @sovereign/web test -- settings-view.test.tsx`** and verify the old breadcrumb/list composition fails.
- [ ] **Step 3: Compose the new UI-kit primitives** and remove shared frame/heading/description rules from application CSS.
- [ ] **Step 4: Run focused web tests and typecheck** and verify green output.
- [ ] **Step 5: Commit** with `refactor(web): use ui kit settings view`.

### Task 3: Appearance and system sections

**Files:**
- Modify: `apps/web/src/settings/appearance-section.tsx`
- Modify: `apps/web/src/settings/daemon-section.tsx`
- Modify: `apps/web/src/settings/diagnostics-section.tsx`
- Modify: `apps/web/src/settings/settings.css`
- Modify: `apps/web/src/settings/settings-view.test.tsx`

**Interfaces:**
- Consumes: `SettingsRow` from Task 1.
- Produces: compact label/description/control rows for Appearance and Daemon and flat diagnostic content.

- [ ] **Step 1: Add failing tests** proving Appearance controls render in four settings rows with the label and hint on the left and control on the right.
- [ ] **Step 2: Run the focused test** and verify failure on the old `Field layout="row"` structure.
- [ ] **Step 3: Convert Appearance and Daemon to SettingsRow** while preserving ids, `aria-describedby`, writes, errors, and translations; keep Diagnostics flat.
- [ ] **Step 4: Run focused tests and typecheck** and verify green output.
- [ ] **Step 5: Commit** with `refactor(web): align system settings with mockup`.

### Task 4: Projects, Providers, and Plugins views

**Files:**
- Modify: `apps/web/src/projects/projects-view.tsx`
- Modify: `apps/web/src/projects/projects-view.test.tsx`
- Modify: `apps/web/src/projects/project-detail-view.tsx`
- Modify: `apps/web/src/projects/project-detail-view.test.tsx`
- Modify: `apps/web/src/providers/providers-view.tsx`
- Modify: `apps/web/src/providers/providers-view.test.tsx`
- Modify: `apps/web/src/plugins/plugins-view.tsx`
- Modify: `apps/web/src/plugins/plugins-view.test.tsx`
- Modify: `apps/web/src/plugins/plugin-detail-view.tsx`
- Modify: `apps/web/src/plugins/plugin-detail-view.test.tsx`
- Modify: `apps/web/src/settings/settings.css`

**Interfaces:**
- Consumes: the heading and content boundary owned by SettingsPage.
- Produces: embedded list/detail bodies without duplicate page headings or outer panels, preserving every domain action and accessible name.

- [ ] **Step 1: Add failing embedded-view tests** for each list and detail proving no nested h1/h2 page title is emitted and domain controls remain present.
- [ ] **Step 2: Run the five focused test files** and verify failure on existing heading or wrapper markup.
- [ ] **Step 3: Remove embedded page chrome and align list/detail spacing** through domain CSS that does not redefine the Settings frame.
- [ ] **Step 4: Run focused tests, the complete web suite, and typecheck** and verify green output.
- [ ] **Step 5: Commit** with `refactor(web): align nested settings views`.

### Task 5: Documentation and visual verification

**Files:**
- Modify: `docs/ui-kit.md`
- Modify: `docs/superpowers/specs/2026-08-03-settings-master-detail-layout-design.md`
- Modify: `docs/superpowers/specs/2026-08-05-settings-projects-section-design.md`

**Interfaces:**
- Documents: the implemented public API and removal of the old SettingsFrame/breadcrumb visual contract.

- [ ] **Step 1: Update active documentation** so it names the four UI-kit primitives and treats the mockup as the visual contract for all six sections.
- [ ] **Step 2: Run Prettier over every changed file** and verify clean formatting.
- [ ] **Step 3: Run `pnpm -r test`, `pnpm -r typecheck`, targeted ESLint, and the web production build** and verify no errors or new warnings.
- [ ] **Step 4: Start only the web Vite server** and compare Appearance, Projects list/detail, Providers list/detail, Plugins list/detail, Daemon, and Diagnostics at wide and narrow widths against the approved mockup.
- [ ] **Step 5: Commit** with `docs(ui): document settings view contract`.
