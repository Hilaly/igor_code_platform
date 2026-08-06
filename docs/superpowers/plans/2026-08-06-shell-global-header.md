# Global Shell Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a permanent, UI-kit-backed header to the central shell column and populate its title, context, and view actions across every current route without changing panel behavior.

**Architecture:** `@sovereign/ui-kit` extends the existing neutral `ViewHeader` with an optional context slot. The web shell renders that primitive in a fixed first grid row and exposes a scoped `useShellHeader` registration context; `App` supplies the route-level base description while nested views can replace it with dynamic metadata/actions that already belong to their local state. The second shell row is the only scroll region for ordinary pages; contained sessions keep their existing internal chat grid below the fixed header.

**Tech Stack:** React 19, TypeScript, CSS Modules in `packages/ui-kit`, application CSS in `apps/web/src/shell/shell.css`, Vitest + Testing Library, Ladle stories, pnpm workspace.

## Global Constraints

- Keep UI geometry, typography, colors, borders, radius, and truncation in the UI kit; shell CSS supplies only host grid geometry and role/scale variables.
- Keep one semantic page heading; do not leave duplicate top-level `h1` elements inside migrated views.
- Empty `context` and `actions` slots render no placeholder and consume no decorative space.
- The header remains fixed by shell grid composition; do not use `position: sticky`, absolute pinning, viewport-height calculations, or a second page scroll container.
- Do not add HTTP routes, protocol fields, global command-menu behavior, or new runtime dependencies.
- Preserve the user's existing staged `logo.svg` and modified `packages/ui-kit/src/styles/styles.test.ts`; do not include either in feature commits.
- Repository checks require Node >=24; the current environment reports Node 22.22.2, so baseline/full checks must be run with the project's Node 24 toolchain when available and the limitation must be reported otherwise.

### Task 1: Extend the UI-kit `ViewHeader` primitive

**Files:**
- Modify: `packages/ui-kit/src/components/view-header.tsx`
- Modify: `packages/ui-kit/src/components/view-header.module.css`
- Modify: `packages/ui-kit/src/components/rendering.test.tsx`
- Modify: `packages/ui-kit/src/components/primitives.stories.tsx`
- Modify: `docs/ui-kit.md`

**Interfaces:**
- Consumes: existing `ViewHeaderProps`, `Heading`, role/scale tokens.
- Produces: `ViewHeaderProps = { title: ReactNode; context?: ReactNode; level?: 1 | 2 | 3; actions?: ReactNode }` with stable `.title`, `.context`, and `.actions` CSS-module slots.

- [ ] **Step 1: Write the failing rendering tests.** Add cases that render title only, title + context, and title + actions; assert the semantic header, heading level, context text, action content, and absence of `.context`/`.actions` markup when the slots are omitted. Add a long context case and assert the wrapper exposes the complete value through `title`.
- [ ] **Step 2: Run the focused UI-kit test and verify it fails.** Run `pnpm --filter @sovereign/ui-kit test -- src/components/rendering.test.tsx`; expect failures because `context` is not accepted/rendered.
- [ ] **Step 3: Implement the minimal primitive extension.** Add `context?: ReactNode`, render it only when defined, keep `title` as the `Heading` wrapper, and update CSS Modules so title/context share a shrinking left group while actions wrap without forcing horizontal overflow. Use only existing kit tokens and the kit's established text/tooltip conventions.
- [ ] **Step 4: Update the catalog story.** Show the compact header with title-only, title + context, and title + actions at wide and narrow container widths; do not add route-specific copy or custom controls.
- [ ] **Step 5: Update UI-kit documentation and rerun focused tests.** Document the context slot and full-name truncation rule in the `ViewHeader` entry, then rerun the rendering test and `pnpm --filter @sovereign/ui-kit typecheck`.
- [ ] **Step 6: Commit the isolated primitive.** Run `git add packages/ui-kit/src/components/view-header.tsx packages/ui-kit/src/components/view-header.module.css packages/ui-kit/src/components/rendering.test.tsx packages/ui-kit/src/components/primitives.stories.tsx docs/ui-kit.md && git commit -m "feat(ui-kit): add view header context slot"`.

### Task 2: Add the shell header contract and permanent two-row central layout

**Files:**
- Create: `apps/web/src/shell/header.tsx`
- Modify: `apps/web/src/shell/shell.tsx`
- Modify: `apps/web/src/shell/shell.css`
- Modify: `apps/web/src/shell/shell.test.tsx`
- Modify: `apps/web/src/shell/styles.test.ts`

**Interfaces:**
- Consumes: UI-kit `ViewHeader`, current `ShellProps`, `ShellLayout`, `contentMode`.
- Produces: `ShellHeaderDescription`, `ShellHeaderProvider`, and `useShellHeader(description)`; `Shell` accepts a route-level `header` description and always renders a permanent central header.

- [ ] **Step 1: Write failing shell behavior tests.** Extend `shell.test.tsx` with a header title/context/actions fixture. Assert one `header` appears before page content, the heading and slots are rendered, and rerendering with a new route description updates header and body together. Add a descendant test component that calls `useShellHeader` and verify the dynamic description replaces the base description while mounted and restores the base after unmount.
- [ ] **Step 2: Write failing CSS contract tests.** Extend `styles.test.ts` to require `.shell-page` as a two-row grid, `.shell-header`/`.shell-body` (or the chosen equivalent) with `min-height: 0`/`min-width: 0`, only the body scroll for page mode, and contained mode preserving a non-scrolling shell host. Assert `shell.css` contains no `sticky`, `absolute` header pinning, `100vh`, or `100dvh` rules for the central content.
- [ ] **Step 3: Implement the registration context.** Define the exported description type and a provider that stores the active description, uses `useLayoutEffect` for registration to avoid a visible stale header on route changes, and restores the route-level base on cleanup. Make the hook accept a complete description so a view can provide dynamic actions without merging ambiguous slots.
- [ ] **Step 4: Implement the shell layout.** Add a required `header` prop, wrap central children in the provider, render `ViewHeader` in a fixed first row, and place children in a second `.shell-body` row. Keep restore buttons in the shell page host but outside the body scroll container so their current behavior is unchanged.
- [ ] **Step 5: Adjust host CSS and pass all existing shell tests.** Preserve existing panel widths, resizers, surfaces, and contained chat sizing. Use `grid-template-rows: auto minmax(0, 1fr)`, `overflow: hidden` on the host, and `overflow: auto` only on the page body where appropriate. Run `pnpm --filter @sovereign/web test -- src/shell/shell.test.tsx src/shell/styles.test.ts`.
- [ ] **Step 6: Commit the shell host.** Run `git add apps/web/src/shell/header.tsx apps/web/src/shell/shell.tsx apps/web/src/shell/shell.css apps/web/src/shell/shell.test.tsx apps/web/src/shell/styles.test.ts && git commit -m "feat(web): pin global header in shell"`.

### Task 3: Provide route-level headers and migrate every current view

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/shell/page.tsx`
- Modify: `apps/web/src/sessions/chat-view.tsx`
- Modify: `apps/web/src/sessions/archive-sessions-view.tsx`
- Modify: `apps/web/src/sessions/new-session-view.tsx`
- Modify: `apps/web/src/settings/settings-view.tsx`
- Modify: `apps/web/src/projects/projects-view.tsx`
- Modify: `apps/web/src/projects/project-detail-view.tsx`
- Modify: `apps/web/src/providers/providers-view.tsx`
- Modify: `apps/web/src/providers/user-provider-form.tsx`
- Modify: `apps/web/src/plugins/plugins-view.tsx`
- Modify: `apps/web/src/plugins/plugin-detail-view.tsx`
- Modify: `apps/web/src/shell/shell.test.tsx` and the affected view tests

**Interfaces:**
- Consumes: `ShellHeaderDescription`, `useShellHeader`, existing translators, route data and local view actions.
- Produces: one shell-level heading/context/actions description for every `Page.kind`, with no duplicate top-level heading inside the page body.

- [ ] **Step 1: Add route descriptor tests before migration.** In `page.test.ts` (create it if needed) cover `home`, `session`, archive, new-session, new/edit provider, settings section/project/plugin, plugin page, and unknown route. Assert stable localized title fallbacks and that unavailable data produces `context: undefined`, never guessed values.
- [ ] **Step 2: Implement base route descriptions in `PageView`/`App`.** Derive the route title and known context from existing data and translator only; pass the description to `Shell`. Keep dynamic session title/model/status and view-local actions out of the base object so nested registration can replace them.
- [ ] **Step 3: Move the session header registration out of the chat body.** In `ChatView`, register `title`, project/model/status context when available, and the existing fork/compact/tree buttons through `useShellHeader`; remove the inner `ViewHeader` so the chat owns no second page header. Keep tree drawer, compact dialog, draft, and composer state local to `ChatView`.
- [ ] **Step 4: Migrate system and CRUD views.** Remove or demote duplicate top-level headings in archive, new-session, settings, projects, providers, provider form, plugins, and plugin detail. Preserve subsection headings and existing `headingLevel` behavior for views embedded inside Settings. Register object-specific context (project path, provider type/state, plugin key/version/state) only when data exists; keep existing buttons/actions in the body unless their handlers already belong to the view header registration.
- [ ] **Step 5: Update view tests for one heading and dynamic slots.** Add assertions that each migrated route has exactly one page-level heading, that session actions still open the same drawer/dialog, and that loading/not-found states retain a stable title with empty context. Run the focused web view tests and fix any snapshots/queries that targeted the removed inner headers.
- [ ] **Step 6: Commit route migration.** Run `git add apps/web/src/App.tsx apps/web/src/shell/page.tsx apps/web/src/sessions apps/web/src/settings/settings-view.tsx apps/web/src/projects apps/web/src/providers apps/web/src/plugins apps/web/src/shell/shell.test.tsx && git commit -m "refactor(web): populate global header across views"`.

### Task 4: Verify responsive scroll behavior and visual alignment

**Files:**
- Modify: `apps/web/src/shell/shell.css` only if focused visual checks identify a host-geometry defect
- Modify: `apps/web/src/shell/styles.test.ts` and relevant component tests for regressions
- Modify: `docs/ui-kit.md` and `docs/superpowers/specs/2026-08-06-shell-global-header-design.md` only if implementation clarifies a documented invariant

**Interfaces:**
- Consumes: completed UI-kit primitive, shell grid, all route registrations.
- Produces: verified desktop and narrow layouts with fixed central header, independent body scrolling, and unchanged side-panel interactions.

- [ ] **Step 1: Run focused checks from the worktree.** Run `pnpm --filter @sovereign/ui-kit test`, `pnpm --filter @sovereign/web test`, and both package typechecks; record any Node-24-only limitation separately rather than weakening project checks.
- [ ] **Step 2: Run formatting and lint checks.** Run `pnpm exec prettier --check .` and `pnpm exec eslint .`; fix only feature-related failures and keep user-owned staged files outside commits.
- [ ] **Step 3: Run builds.** Run `pnpm --recursive run build`; verify the UI-kit catalog can import the updated story and the web build emits no new warnings.
- [ ] **Step 4: Perform browser QA.** Check a long session history, archive, Settings, provider/plugin details, unknown route, narrow central width, hidden/restored side panels, and a long title/context. Confirm the header stays fixed while only the body scrolls and no controls overlap.
- [ ] **Step 5: Commit documentation/verification adjustments.** If no documentation change is required, do not create a no-op commit; otherwise use `docs(ui): document global shell header verification`.

## Self-review checklist

- Every spec section maps to Tasks 1–4: UI-kit contract (1), shell permanence (2), all current route slots (3), accessibility and responsive verification (1–4).
- No new HTTP/protocol/dependency work is planned.
- All names are consistent: `ShellHeaderDescription`, `ShellHeaderProvider`, `useShellHeader`, `ViewHeaderProps.context`.
- The plan leaves no duplicate top-level headings and explicitly tests empty slots, route changes, loading states, and contained chat scrolling.
