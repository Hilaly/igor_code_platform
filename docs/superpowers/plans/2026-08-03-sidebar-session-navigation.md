# Sidebar Session Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the technical sidebar routes and central session catalog with a persistent project/session tree, move providers and plugins into settings, and add an archived-sessions screen.

**Architecture:** Keep `App` as the owner of long-lived controllers and compose a domain-specific `SidebarProjects` from the existing project/session snapshots. Extend only domain-neutral UI-kit primitives (`Tree` actions and `StatusDot`), render `ChatView` directly for `/sessions/:id`, and give the archive its own filtered controller so the active sidebar never changes datasets.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, CSS Modules, Ladle, pnpm workspace.

## Global Constraints

- Work only in `.claude/worktrees/feat-sidebar-session-navigation` on `feat/sidebar-session-navigation`.
- Keep the current visual language, right panel, chat content, server contracts, and project creation flow unchanged.
- The top system area contains only `Sovereign` and “Новая сессия”.
- All reusable interactive elements must come from `@sovereign/ui-kit`; application CSS may define only composition and geometry.
- Active sessions remain in the sidebar while archived sessions load in the archive view.
- Use test-first red/green cycles and make atomic commits in English.

---

## File Map

- `packages/ui-kit/src/components/status-dot.tsx` and `.module.css`: accessible, domain-neutral connection dot.
- `packages/ui-kit/src/components/tree.tsx` and `.module.css`: optional per-node action slot that does not select or expand the row.
- `packages/ui-kit/src/components/interactive-components.test.tsx`: behavior and DOM contracts for both primitives.
- `packages/ui-kit/src/components/primitives.stories.tsx`, `packages/ui-kit/src/index.ts`: catalog scenarios and public exports.
- `apps/web/src/router.ts`: canonical session/archive/settings-provider/plugin routes and legacy redirects.
- `apps/web/src/settings/settings-view.tsx`: five settings sections and nested provider content.
- `apps/web/src/sessions/archive-sessions-view.tsx`: grouped archived-session list with restore/delete/open actions.
- `apps/web/src/sessions/sidebar-projects.tsx`: project/session tree, local expansion persistence, and row actions.
- `apps/web/src/sessions/use-sessions.ts`: explicit archive dataset option without changing the active controller.
- `apps/web/src/shell/account-control.tsx`: account menu plus one status dot.
- `apps/web/src/App.tsx`: controller composition and direct `ChatView` rendering.
- `apps/web/src/projects/project-detail-view.tsx`: remove the duplicated session catalog while preserving project data/resources.
- `apps/web/src/shell/shell.css`: sidebar composition geometry only.
- Corresponding `*.test.tsx` files: route, settings, archive, sidebar, project detail, and shell integration contracts.

### Task 1: UI-kit status and tree actions

**Files:**

- Create: `packages/ui-kit/src/components/status-dot.tsx`
- Create: `packages/ui-kit/src/components/status-dot.module.css`
- Modify: `packages/ui-kit/src/components/tree.tsx`
- Modify: `packages/ui-kit/src/components/tree.module.css`
- Modify: `packages/ui-kit/src/components/interactive-components.test.tsx`
- Modify: `packages/ui-kit/src/components/primitives.stories.tsx`
- Modify: `packages/ui-kit/src/index.ts`

**Interfaces:**

- Produces: `StatusDot({ tone: "positive" | "pending" | "danger", label: string })`.
- Produces: `TreeNode.actions?: ReactNode` rendered beside its row and isolated from tree selection.

- [ ] **Step 1: Write failing UI-kit tests**

```tsx
it("names a status dot without exposing its color", () => {
  render(<StatusDot tone="positive" label="Демон подключён" />);
  expect(screen.getByRole("status", { name: "Демон подключён" }).title).toBe("Демон подключён");
});

it("keeps Tree actions independent from row selection", () => {
  const onSelect = vi.fn();
  render(
    <Tree
      label="Проекты"
      toggleLabel={treeToggleLabel}
      onSelect={onSelect}
      nodes={[{ id: "project", label: "Alpha", actions: <button>Создать сессию</button> }]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Создать сессию" }));
  expect(onSelect).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @sovereign/ui-kit test -- interactive-components.test.tsx`

Expected: FAIL because `StatusDot` and `TreeNode.actions` do not exist.

- [ ] **Step 3: Implement the minimal UI-kit contracts**

```tsx
export function StatusDot({ tone, label }: StatusDotProps) {
  return (
    <span
      className={`${styles.dot} ${styles[tone]}`}
      role="status"
      aria-label={label}
      title={label}
    />
  );
}

{
  node.actions ? (
    <span
      className={styles.actions}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {node.actions}
    </span>
  ) : null;
}
```

- [ ] **Step 4: Run UI-kit tests and typecheck**

Run: `pnpm --filter @sovereign/ui-kit test && pnpm --filter @sovereign/ui-kit typecheck`

Expected: PASS with no warnings.

- [ ] **Step 5: Add the public export and Ladle scenarios, then commit**

```bash
git add packages/ui-kit/src
git commit -m "feat(ui-kit): add status dot and tree actions"
```

### Task 2: Canonical navigation routes

**Files:**

- Modify: `apps/web/src/router.ts`
- Modify: `apps/web/src/router.test.ts`
- Modify: `apps/web/src/router-navigation.test.ts`

**Interfaces:**

- Produces: page kinds `session`, `session-archive`, and `settings` with sections `appearance | providers | plugins | daemon | diagnostics` plus optional `providerId`.
- Produces: canonical paths `/sessions/:id`, `/sessions/new`, `/sessions/archive`, `/settings/providers/:providerId`, and legacy replacements for `/sessions`, `/providers/*`, `/plugins`.

- [ ] **Step 1: Write failing route tests**

```ts
expect(matchPage("/sessions/archive")).toEqual({ kind: "session-archive" });
expect(matchPage("/sessions/s-1")).toEqual({ kind: "session", sessionId: "s-1" });
expect(matchPage("/settings/providers/openai")).toEqual({
  kind: "settings",
  section: "providers",
  providerId: "openai",
});
expect(canonicalPage(matchPage("/providers/openai"))).toEqual({
  page: { kind: "settings", section: "providers", providerId: "openai" },
  path: "/settings/providers/openai",
});
```

- [ ] **Step 2: Run router tests and verify RED**

Run: `pnpm --filter @sovereign/web test -- router.test.ts router-navigation.test.ts`

Expected: FAIL on unknown new page kinds and missing canonical replacement.

- [ ] **Step 3: Implement parsing, formatting, and history replacement**

Keep provider identifier encoding from the existing router and make `createNavigation.current()` replace legacy URLs with their canonical path before publishing the page.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm --filter @sovereign/web test -- router.test.ts router-navigation.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/router.ts apps/web/src/router.test.ts apps/web/src/router-navigation.test.ts
git commit -m "refactor(web): move system routes into settings"
```

### Task 3: Separate active and archived session datasets

**Files:**

- Modify: `apps/web/src/sessions/use-sessions.ts`
- Modify: `apps/web/src/sessions/use-sessions.test.tsx`
- Create: `apps/web/src/sessions/archive-sessions-view.tsx`
- Create: `apps/web/src/sessions/archive-sessions-view.test.tsx`

**Interfaces:**

- Consumes: existing `fetchSessions({ archived, projectId })`, `updateSession`, and `deleteSession` APIs.
- Produces: `useSessions({ ..., archived?: boolean, sessionId?: string })` whose snapshot filter is fixed per controller.
- Produces: `ArchiveSessionsView({ sessions, projects, loaded, failure, onOpen, onRestore, onRemove, translator })`.

- [ ] **Step 1: Write a failing controller test for fixed archived loading**

```tsx
renderHook(() => useSessions({ bus, stream: "open", archived: true, onDiagnostic }));
await waitFor(() =>
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining("archived=true"),
    expect.anything(),
  ),
);
```

- [ ] **Step 2: Run the controller test and verify RED**

Run: `pnpm --filter @sovereign/web test -- use-sessions.test.tsx`

Expected: FAIL because archive selection is currently mutable view state.

- [ ] **Step 3: Implement a fixed dataset option and keep session detail loading independent**

Use `archived ?? false` for list requests and remove archive-filter ownership from the central view contract.

- [ ] **Step 4: Write failing archive-view tests**

```tsx
expect(screen.getByRole("heading", { name: "Alpha" })).toBeTruthy();
fireEvent.click(screen.getByRole("button", { name: "Восстановить Session A" }));
expect(onRestore).toHaveBeenCalledWith("session-a");
fireEvent.click(screen.getByRole("button", { name: "Удалить Session A" }));
fireEvent.click(screen.getByRole("button", { name: "Удалить безвозвратно" }));
expect(onRemove).toHaveBeenCalledWith("session-a");
```

- [ ] **Step 5: Implement grouped archive rows from UI-kit primitives and verify**

Run: `pnpm --filter @sovereign/web test -- use-sessions.test.tsx archive-sessions-view.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/sessions
git commit -m "feat(web): add archived sessions view"
```

### Task 4: Project/session sidebar

**Files:**

- Create: `apps/web/src/sessions/sidebar-projects.tsx`
- Create: `apps/web/src/sessions/sidebar-projects.test.tsx`
- Modify: `apps/web/src/shell/shell.css`
- Modify: `packages/ui-kit/src/i18n/messages/en.ts`
- Modify: `packages/ui-kit/src/i18n/messages/ru.ts`

**Interfaces:**

- Consumes: active `Project[]`, active `Session[]`, selected session id, project/session mutation callbacks, and `Tree`, `Button`, `Menu`, `ConfirmDialog`.
- Produces: `SidebarProjects` with controlled expanded ids stored under `sovereign.sidebar.expanded-projects`.

- [ ] **Step 1: Write failing sidebar tests for hierarchy and persistence**

```tsx
expect(screen.getByRole("treeitem", { name: /Alpha/ })).toBeTruthy();
fireEvent.click(screen.getByRole("button", { name: "Развернуть Alpha" }));
expect(screen.getByRole("treeitem", { name: /Session A/ })).toBeTruthy();
expect(JSON.parse(storage.getItem("sovereign.sidebar.expanded-projects")!)).toEqual(["alpha"]);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm --filter @sovereign/web test -- sidebar-projects.test.tsx`

Expected: FAIL because the component is absent.

- [ ] **Step 3: Implement grouping, selected-session expansion, and stale-id pruning**

Build tree ids as `project:<id>` and `session:<id>`, map selection only for session nodes, and persist raw project ids after every controlled expansion change.

- [ ] **Step 4: Add failing action tests, then implement project/session menus**

Test create-in-project, rename, archive, confirmed delete, disabled unavailable-project actions, and the guarantee that action clicks do not navigate.

- [ ] **Step 5: Run sidebar tests and verify GREEN**

Run: `pnpm --filter @sovereign/web test -- sidebar-projects.test.tsx`

Expected: PASS with no console warnings.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/sessions/sidebar-projects.tsx apps/web/src/sessions/sidebar-projects.test.tsx apps/web/src/shell/shell.css packages/ui-kit/src/i18n/messages
git commit -m "feat(web): add project session sidebar"
```

### Task 5: Account control and settings sections

**Files:**

- Create: `apps/web/src/shell/account-control.tsx`
- Create: `apps/web/src/shell/account-control.test.tsx`
- Modify: `apps/web/src/settings/settings-view.tsx`
- Modify: `apps/web/src/settings/settings.css`
- Create: `apps/web/src/settings/settings-view.test.tsx`

**Interfaces:**

- Consumes: stream/failure, translator, logout/archive/settings navigation callbacks, and existing provider/plugin view nodes.
- Produces: `AccountControl` with exactly one `StatusDot` and account menu items.
- Produces: `SettingsView` props `providers` and `plugins` and the five-section navigation order.

- [ ] **Step 1: Write failing account-control tests**

```tsx
expect(screen.getAllByRole("status")).toHaveLength(1);
expect(screen.getByRole("status", { name: "Демон подключён" })).toBeTruthy();
fireEvent.click(screen.getByRole("button", { name: "Аккаунт" }));
fireEvent.click(screen.getByRole("menuitem", { name: "Архивные сессии" }));
expect(onOpenArchive).toHaveBeenCalledOnce();
```

- [ ] **Step 2: Run the test and verify RED, then implement `AccountControl`**

Run: `pnpm --filter @sovereign/web test -- account-control.test.tsx`

Expected before implementation: FAIL because the component is absent. Expected after: PASS.

- [ ] **Step 3: Write failing settings tests for providers and plugins**

Assert the five tab labels in order and that selecting `providers`/`plugins` renders the supplied node.

- [ ] **Step 4: Implement the settings sections and verify GREEN**

Run: `pnpm --filter @sovereign/web test -- settings-view.test.tsx account-control.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/shell/account-control* apps/web/src/settings
git commit -m "feat(web): move system views into settings"
```

### Task 6: App integration and direct chat rendering

**Files:**

- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/shell/page.tsx`
- Modify: `apps/web/src/projects/project-detail-view.tsx`
- Modify: `apps/web/src/projects/project-detail-view.test.tsx`
- Modify: `apps/web/src/shell/shell.test.tsx`
- Delete: `apps/web/src/shell/daemon-status.tsx`

**Interfaces:**

- Consumes: `SidebarProjects`, `AccountControl`, `ArchiveSessionsView`, and existing `ChatView`.
- Produces: one active sessions controller for sidebar/session/new-session and one archive controller only on the archive page.

- [ ] **Step 1: Change integration tests first**

Assert that the authenticated shell contains `Sovereign`, only the new-session system action, project/session tree, account status dot, and no permanent providers/plugins/sessions navigation rows. Assert project detail no longer receives or renders a sessions region.

- [ ] **Step 2: Run integration tests and verify RED**

Run: `pnpm --filter @sovereign/web test -- shell.test.tsx project-detail-view.test.tsx`

Expected: FAIL on the old navigation and embedded session list.

- [ ] **Step 3: Integrate controllers and render `ChatView` directly**

For `page.kind === "session"`, pass the existing open-session state/actions directly to `ChatView`. For `session-archive`, render `ArchiveSessionsView`. Put providers/plugins nodes into `SettingsView`. Remove the old `SessionsView` composition and textual `DaemonStatus`.

- [ ] **Step 4: Run all web tests and typecheck**

Run: `pnpm --filter @sovereign/web test && pnpm --filter @sovereign/web typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "refactor(web): make sessions sidebar-first"
```

### Task 7: Documentation and full verification

**Files:**

- Modify: `docs/README.md`
- Modify: `docs/web-api.md` only if it describes the removed client navigation.
- Modify: `docs/superpowers/specs/2026-08-03-sidebar-session-navigation-design.md` to clarify that the project detail keeps its project content but drops the duplicate sessions block.

**Interfaces:**

- Produces: documentation matching the shipped client behavior.

- [ ] **Step 1: Update relevant documentation and plan checkboxes**

Record the sidebar tree, canonical routes, archive behavior, settings sections, and project-detail exception without documenting implementation-private component names.

- [ ] **Step 2: Run formatting and lint checks**

Run: `pnpm prettier --check . && pnpm eslint .`

Expected: PASS.

- [ ] **Step 3: Run the full workspace verification**

Run: `pnpm -r test && pnpm -r typecheck && pnpm -r build`

Expected: PASS with no warnings or unhandled errors.

- [ ] **Step 4: Verify in the authenticated browser**

At `http://localhost:5273/`, check the sidebar, project expansion, session navigation, new-session project preselection, account status/menu, archive restore/delete dialogs, settings provider/plugin routes, back/forward navigation, and unchanged right panel. Capture screenshots of the sidebar, archive, and settings states.

- [ ] **Step 5: Inspect the final diff and commit documentation**

```bash
git diff --check
git status --short
git add docs
git commit -m "docs(web): describe sidebar session navigation"
```
