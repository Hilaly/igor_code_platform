# Sidebar Context Card Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep sidebar context cards anchored to the right of their visible tree row, shrink them into the remaining viewport width, and show project paths in at most 20 characters without losing the full value.

**Architecture:** The generic geometry stays in `Tree`: it measures the rendered row rather than the `display: contents` treeitem and gives the portaled layer an explicit width derived from the right-side viewport space. The web project module owns strict middle truncation and passes the full folder through the existing `TreeContextCardFact` primitive's new optional `title` prop.

**Tech Stack:** React 19, TypeScript, CSS Modules, Vitest, Testing Library, pnpm.

## Global Constraints

- Work only in `/Users/user/repos/sovereign_platform_node/.worktrees/sidebar-context-card-placement` on `fix/sidebar-context-card-placement`.
- A context card always stays to the right of the visible row with the existing 8 px gap.
- The layer width never exceeds the space before the viewport's 8 px safe edge.
- The visible project or session path contains at most 20 Unicode code points and uses one middle ellipsis when shortened.
- The complete path remains available in `title`.
- Preserve the hover bridge, delayed close, focus opening, portal rendering, project/session actions, and daemon contracts.
- Follow strict TDD: run every new regression test against the unchanged production implementation and observe the expected failure before editing production code.

---

### Task 1: Right-anchored viewport-safe Tree context geometry

**Files:**

- Modify: `packages/ui-kit/src/components/tree.tsx`
- Modify: `packages/ui-kit/src/components/tree.module.css`
- Modify: `packages/ui-kit/src/components/tree-context-card.module.css`
- Test: `packages/ui-kit/src/components/interactive-components.test.tsx`

**Interfaces:**

- Consumes: the existing `TreeNode.context?: ReactNode`, portaled context layer, and `.row` element rendered as the first direct child of each `role="treeitem"`.
- Produces: `{ top: number; left: number; width: number }` inline context geometry anchored from the visible row's `DOMRect`; a context card that can shrink to the wrapper width.

- [ ] **Step 1: Write the failing geometry regression test**

Add a test after the existing Tree context interaction test. Render one contextual node, enter its treeitem, then mock the visible row and tooltip rectangles:

```tsx
const project = screen.getByRole("treeitem", { name: "Alpha" });
const row = project.firstElementChild as HTMLElement;
vi.spyOn(project, "getBoundingClientRect").mockReturnValue(rect({ left: 0, right: 0 }));
vi.spyOn(row, "getBoundingClientRect").mockReturnValue(
  rect({ left: 16, right: 316, top: 240, bottom: 280, width: 300, height: 40 }),
);
fireEvent.pointerEnter(project);
const context = screen.getByRole("tooltip", { name: "Alpha" });
vi.spyOn(context, "getBoundingClientRect").mockReturnValue(rect({ width: 384, height: 180 }));
Object.defineProperty(window, "innerWidth", { configurable: true, value: 600 });
Object.defineProperty(window, "innerHeight", { configurable: true, value: 360 });
fireEvent(window, new Event("resize"));

expect(context.style.left).toBe("324px");
expect(context.style.width).toBe("268px");
expect(context.style.top).toBe("172px");
```

Define a local `rect` test helper that fills all required `DOMRect` fields from partial numeric input. The production mutation this catches is measuring the `display: contents` treeitem or clamping `left` back over the row.

- [ ] **Step 2: Run the target test and verify RED**

Run:

```bash
pnpm --filter @sovereign/ui-kit test -- src/components/interactive-components.test.tsx
```

Expected: the new test fails because `left` is derived from the mocked zero-width treeitem and the layer does not receive the expected explicit width.

- [ ] **Step 3: Implement minimal row measurement and right-side sizing**

In `Tree`, resolve the context anchor from `event.currentTarget.firstElementChild` when it is an `HTMLDivElement`, falling back to the treeitem only when the row is absent. Keep the active context type as an HTML element anchor. In `updatePosition` calculate:

```ts
const viewportPadding = 8;
const gap = 8;
const left = anchor.right + gap;
const availableWidth = Math.max(0, window.innerWidth - viewportPadding - left);
const width = Math.min(context?.width ?? availableWidth, availableWidth);
const top = Math.min(
  Math.max(anchor.top, viewportPadding),
  Math.max(viewportPadding, window.innerHeight - (context?.height ?? 0) - viewportPadding),
);
setContextPosition({ top, left, width });
```

Update the context position state type to include `width`. In `tree-context-card.module.css`, make `.card` use `box-sizing: border-box`, `width: 100%`, `min-width: min(15rem, 100%)`, and `max-width: 100%` so its intrinsic minimum cannot overflow the sized portal wrapper. Do not alter the close timer or focus handlers.

- [ ] **Step 4: Run UI-kit tests and verify GREEN**

Run:

```bash
pnpm --filter @sovereign/ui-kit test
```

Expected: 206 or more UI-kit tests pass with zero failures and no new warnings.

- [ ] **Step 5: Commit the geometry fix**

```bash
git add packages/ui-kit/src/components/tree.tsx packages/ui-kit/src/components/tree.module.css packages/ui-kit/src/components/tree-context-card.module.css packages/ui-kit/src/components/interactive-components.test.tsx
git commit -m "fix(ui-kit): anchor tree context cards to rows"
```

### Task 2: Strict 20-character sidebar paths

**Files:**

- Modify: `apps/web/src/projects/path-shorten.ts`
- Modify: `apps/web/src/projects/path-shorten.test.ts`
- Modify: `packages/ui-kit/src/components/tree-context-card.tsx`
- Modify: `packages/ui-kit/src/components/rendering.test.tsx`
- Modify: `apps/web/src/sessions/sidebar-projects.tsx`
- Modify: `apps/web/src/sessions/sidebar-projects.test.tsx`
- Modify: `docs/ui-kit.md`
- Modify: `docs/README.md`
- Test: `apps/web/src/projects/path-shorten.test.ts`
- Test: `packages/ui-kit/src/components/rendering.test.tsx`
- Test: `apps/web/src/sessions/sidebar-projects.test.tsx`

**Interfaces:**

- Consumes: the unchanged `shortenPath(folder: string, max?: number): string` and both project/session `folder` values already present in snapshots.
- Produces: `shortenPathMiddle(folder: string, max?: number): string`; `TreeContextCardFact({ icon?, title?, children })`; visible paths of at most 20 Unicode code points with full paths in `title`.

- [ ] **Step 1: Write failing strict truncation tests**

Add focused cases to `path-shorten.test.ts`:

```ts
describe("shortenPathMiddle", () => {
  it("keeps a short path untouched", () => {
    expect(shortenPathMiddle("/code/alpha", 20)).toBe("/code/alpha");
  });

  it("strictly keeps the start and end within twenty characters", () => {
    const shortened = shortenPathMiddle("/Users/user/repos/sovereign_platform_node", 20);
    expect(shortened).toBe("/Users/use…form_node");
    expect(Array.from(shortened)).toHaveLength(20);
  });

  it("does not split Unicode surrogate pairs", () => {
    const shortened = shortenPathMiddle("/Users/😀😀😀/sovereign_platform_node", 20);
    expect(Array.from(shortened)).toHaveLength(20);
    expect(shortened).not.toContain("�");
  });
});
```

Import `shortenPathMiddle` alongside `shortenPath`. The production mutation this catches is returning the existing soft limit when the final folder name alone exceeds 20 characters.

- [ ] **Step 2: Write failing card title and sidebar path tests**

In `rendering.test.tsx`, render `<TreeContextCardFact title="/full/path">short</TreeContextCardFact>` and assert the fact text carries `title="/full/path"`.

In `sidebar-projects.test.tsx`, render project and session fixtures with `folder: "/Users/user/repos/sovereign_platform_node"`. Open each context card and assert:

```ts
const visiblePath = "/Users/use…form_node";
expect(screen.getByText(visiblePath).getAttribute("title")).toBe(longFolder);
expect(Array.from(visiblePath)).toHaveLength(20);
```

Close the project card by moving to the session row before looking up the session value so the duplicate portaled path cannot make the query ambiguous.

- [ ] **Step 3: Run targets and verify RED**

Run:

```bash
pnpm --filter @sovereign/web test -- src/projects/path-shorten.test.ts src/sessions/sidebar-projects.test.tsx
pnpm --filter @sovereign/ui-kit test -- src/components/rendering.test.tsx
```

Expected: compilation or assertions fail because `shortenPathMiddle` and the `title` prop do not exist and sidebar cards still render full paths.

- [ ] **Step 4: Implement the minimal strict helper and title plumbing**

Add this sibling helper in `path-shorten.ts` without changing `shortenPath`:

```ts
export function shortenPathMiddle(folder: string, max = 40): string {
  const characters = Array.from(folder);
  if (characters.length <= max) return folder;
  if (max <= 1) return "…";

  const remaining = max - 1;
  const headLength = Math.ceil(remaining / 2);
  const tailLength = Math.floor(remaining / 2);
  return `${characters.slice(0, headLength).join("")}…${characters.slice(-tailLength).join("")}`;
}
```

Extend `TreeContextCardFact` with `title?: string` and put it on `.factText`. Import `shortenPathMiddle` into `sidebar-projects.tsx`, define `const sidebarPathLength = 20`, and use `shortenPathMiddle(project.folder, sidebarPathLength)` for both project and session cards while passing `title={project.folder}`.

- [ ] **Step 5: Update durable documentation**

Update the sidebar paragraph in `docs/ui-kit.md` to state that context cards remain right-anchored, shrink into viewport space, and show a 20-character middle-shortened folder with the full value in `title`. Add this implementation plan next to its design entry in `docs/README.md`.

- [ ] **Step 6: Format and run target tests GREEN**

Run:

```bash
pnpm exec prettier --write packages/ui-kit/src/components/tree.tsx packages/ui-kit/src/components/tree.module.css packages/ui-kit/src/components/tree-context-card.tsx packages/ui-kit/src/components/tree-context-card.module.css packages/ui-kit/src/components/interactive-components.test.tsx packages/ui-kit/src/components/rendering.test.tsx apps/web/src/projects/path-shorten.ts apps/web/src/projects/path-shorten.test.ts apps/web/src/sessions/sidebar-projects.tsx apps/web/src/sessions/sidebar-projects.test.tsx docs/ui-kit.md docs/README.md docs/superpowers
pnpm --filter @sovereign/web test -- src/projects/path-shorten.test.ts src/sessions/sidebar-projects.test.tsx
pnpm --filter @sovereign/ui-kit test -- src/components/rendering.test.tsx
```

Expected: both web files and the UI-kit rendering target pass with zero failures.

- [ ] **Step 7: Run full verification**

Run:

```bash
make typecheck
make lint
make fmt-check
pnpm --filter @sovereign/ui-kit test
pnpm --filter @sovereign/web test
make build
```

Expected: every command exits 0; UI kit reports at least 206 passing tests, web reports at least 637 passing tests, and Vite produces the web build without new warnings.

- [ ] **Step 8: Commit the path behavior and documentation**

```bash
git add apps/web/src/projects/path-shorten.ts apps/web/src/projects/path-shorten.test.ts apps/web/src/sessions/sidebar-projects.tsx apps/web/src/sessions/sidebar-projects.test.tsx packages/ui-kit/src/components/tree-context-card.tsx packages/ui-kit/src/components/rendering.test.tsx docs/ui-kit.md docs/README.md docs/superpowers
git commit -m "fix(web): constrain sidebar context paths"
```
