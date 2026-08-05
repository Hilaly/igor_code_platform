# UI Polish Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make project path truncation portable and accessible, make branding contrast-safe and
documented, correct the shell regression probe, and leave a clean branch rebased on current main.

**Architecture:** Path parsing stays in the web-owned pure helper; UI Kit only exposes the IDs needed
to connect a selectable row to its existing tooltip. Branding remains a UI Kit primitive, with its
visual role and accessibility semantics enforced there. No dependencies or runtime tooltip state are
added.

**Tech Stack:** TypeScript, React 19, CSS Modules, Vitest, Testing Library, Storybook, pnpm 11.

## Global Constraints

- Preserve the input path's separator family and root form.
- Keep the final path component whole even when it exceeds the nominal limit.
- Do not create a focusable descendant inside a selectable `ListRow`.
- Use only existing UI Kit role tokens and add no dependencies.
- Every behavior change starts with a failing regression test.
- Every commit must pass its focused tests and formatting.

---

### Task 1: Portable tail-first path shortening

**Files:**

- Modify: `apps/web/src/projects/path-shorten.test.ts`
- Modify: `apps/web/src/projects/path-shorten.ts`

**Interfaces:**

- Consumes: `shortenPath(folder: string, max?: number): string`.
- Produces: the same function with POSIX, drive, UNC, multi-parent, and Unicode behavior.

- [ ] **Step 1: Write failing path tests**

  Add expectations for `C:\\Users\\me\\repos\\product`, `\\\\server\\share\\team\\product`, a
  tail that can fit three parents, and Unicode segments. Assert exact preserved roots and separators.

- [ ] **Step 2: Verify the regression tests fail**

  Run `pnpm --filter @sovereign/web test -- src/projects/path-shorten.test.ts`; existing code must
  fail on backslashes and on the third parent.

- [ ] **Step 3: Implement path parsing and suffix growth**

  Parse the root into POSIX `/`, drive `C:\\`, UNC `\\server\share\\`, or empty relative root.
  Split the remaining path on either separator, grow the suffix right-to-left while it fits, then
  attempt to prepend the first omitted component before the ellipsis.

- [ ] **Step 4: Verify and commit**

  Re-run the focused test and `make fmt-check`, then commit as
  `fix(web): make project path shortening portable`.

### Task 2: Keyboard-accessible full project path

**Files:**

- Modify: `packages/ui-kit/src/components/tooltip.tsx`
- Modify: `packages/ui-kit/src/components/list.tsx`
- Modify: `packages/ui-kit/src/components/interactive-components.test.tsx`
- Modify: `apps/web/src/projects/projects-view.tsx`
- Modify: `apps/web/src/projects/projects-view.test.tsx`
- Modify: `apps/web/src/styles/projects.css`
- Modify: `docs/ui-kit.md`

**Interfaces:**

- Produces: `TooltipProps.id?: string` and `ListRowProps.describedBy?: string`.
- Consumes: one `useId()` value in `ProjectRow`, passed to both primitives.

- [ ] **Step 1: Write failing UI Kit and project integration tests**

  Assert that an explicit tooltip ID is used, the selectable row receives `aria-describedby`, and
  the referenced tooltip contains the full unshortened folder.

- [ ] **Step 2: Verify both tests fail for missing API/association**

  Run the focused UI Kit and web test files and confirm the failures describe the absent props.

- [ ] **Step 3: Add the minimal ID plumbing and focus style**

  Prefer the explicit tooltip ID over `useId`, forward `describedBy` only to the selectable button,
  create the ID in `ProjectRow`, and reveal `[role="tooltip"]` when the containing row button has
  `:focus-visible`.

- [ ] **Step 4: Document, verify, and commit**

  Document both optional props in `docs/ui-kit.md`, run focused tests plus `make fmt-check`, and
  commit as `fix(web): expose full project paths on row focus`.

### Task 3: Accessible and contrast-safe branding

**Files:**

- Modify: `packages/ui-kit/src/components/brand-lockup.tsx`
- Modify: `packages/ui-kit/src/components/brand-lockup.module.css`
- Modify: `packages/ui-kit/src/components/rendering.test.tsx`
- Modify: `packages/ui-kit/src/components/styles.test.ts`
- Modify: `packages/ui-kit/src/catalog/primitives.stories.tsx`
- Modify: `docs/ui-kit.md`

**Interfaces:**

- Preserves: `BrandLockup({name}: BrandLockupProps)` and decorative default `BrandMark`.
- Produces: exposed product-name text and `--sovereign-accent-text` styling.

- [ ] **Step 1: Write failing semantic and style-role tests**

  Assert that the lockup container is not hidden, its SVG remains decorative, and its CSS uses
  `--sovereign-accent-text` rather than `--sovereign-accent`.

- [ ] **Step 2: Verify focused tests fail**

  Run UI Kit rendering and style tests and confirm both current defects are reproduced.

- [ ] **Step 3: Correct semantics and role token**

  Remove `aria-hidden` from the lockup container, retain the decorative mark default, and switch
  the lockup color to the contrast-safe text role.

- [ ] **Step 4: Add catalog coverage and public documentation**

  Add a `Branding` story for mark and lockup, and document their props and accessibility behavior
  in the primitives section of `docs/ui-kit.md`.

- [ ] **Step 5: Verify and commit**

  Run all UI Kit tests and `make fmt-check`, then commit as
  `fix(ui-kit): make product branding accessible`.

### Task 4: Commit-phase shell mount probe

**Files:**

- Modify: `apps/web/src/shell/shell.test.tsx`

**Interfaces:**

- Preserves production behavior; produces a probe that reports mount/unmount from `useEffect`.

- [ ] **Step 1: Replace render-phase refs with an effect probe**

  Use `useEffect(() => { onMount(); return onUnmount; }, [onMount, onUnmount])` and assert one mount,
  zero unmounts before test cleanup across page rerenders.

- [ ] **Step 2: Verify and commit**

  Run the shell test and `make fmt-check`, then commit as
  `test(shell): measure committed sidebar mounts`.

### Task 5: Rewrite history and rebase

**Files:** none; Git history only.

- [ ] **Step 1: Correct the original five commits**

  Reword the malformed shell-test commit and move the formatting-only hunk for `icons.tsx` into the
  UI Kit brand commit so every original commit passes `make fmt-check` independently.

- [ ] **Step 2: Rebase onto current `main`**

  Fetch `origin`, rebase the complete feature series onto `origin/main`, resolve only in-scope
  conflicts, and verify the resulting range against its new base.

### Task 6: Final verification and review

**Files:** all files changed in Tasks 1-4.

- [ ] **Step 1: Run full checks**

  Run `make check`, `make build`, and `git diff --check origin/main...HEAD`.

- [ ] **Step 2: Audit history and state**

  Confirm clean `git status`, Conventional Commit subjects, and that the branch merge-base equals
  current `origin/main`.

- [ ] **Step 3: Request independent code review**

  Give a reviewer the design, plan, base SHA, and head SHA. Resolve every Critical or Important
  finding, then repeat focused and full verification as needed.
