# Session Live Markdown Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep live tool calls inside the session reading column and render reasoning plus streamed agent text with the UI-kit Markdown component.

**Architecture:** Reuse the existing `Message` and `Markdown` primitives. The protocol and session state remain unchanged; only the web session composition changes, plus tests and documentation of the accepted streaming trade-off.

**Tech Stack:** React 19, TypeScript, `react-markdown`, `remark-gfm`, `rehype-sanitize`, Vitest, Testing Library, pnpm workspace.

## Global Constraints

- JSON viewer is out of scope; `ToolCall` continues to receive and render `argumentsText` through `CodeBlock`.
- Live tool calls are visual children of an agent `Message`, not separate persisted messages or protocol entries.
- Streamed Markdown is parsed on every render with no debounce or stable-block segmentation.
- No new dependencies.

---

### Task 1: Add regression coverage for session composition

**Files:**

- Modify: `apps/web/src/sessions/session-message-list.test.tsx`
- Test: `apps/web/src/sessions/session-message-list.test.tsx`

**Interfaces:**

- Consumes: existing `SessionMessageList`, `OpenSession`, and live `StreamedItem` fixtures.
- Produces: failing assertions for live tool-call containment and Markdown rendering of live reasoning/text.

- [x] **Step 1: Write failing tests**

  Add tests that render a live tool item and assert its closest message has `data-role="agent"`, and
  that live reasoning and unfinished answer text produce Markdown tags (`<strong>`, `<h2>`, or equivalent
  GFM output) rather than only a plain text node.

- [x] **Step 2: Run the focused tests and verify they fail**

  Run: `pnpm --filter @sovereign/web test -- src/sessions/session-message-list.test.tsx --run`

  Expected: the containment and live-Markdown assertions fail against the current direct `ToolCall`
  and `StreamingText`/`Text` rendering.

### Task 2: Implement live Markdown and width containment

**Files:**

- Modify: `apps/web/src/sessions/session-message-list.tsx`
- Modify: `packages/ui-kit/src/components/streaming-text.tsx`
- Modify: `packages/ui-kit/src/components/streaming-text.module.css` only if the Markdown wrapper needs a compatible caret style
- Modify: `packages/ui-kit/src/components/rendering.test.tsx` if the public `StreamingText` contract changes

**Interfaces:**

- Consumes: existing `Markdown`, `Message`, `Disclosure`, and `ToolCall` props.
- Produces: live tool calls constrained by the same `Message` width and `StreamingText` rendering the supplied text through `Markdown` while retaining `aria-busy`, label, and caret.

- [x] **Step 1: Implement the smallest composition change**

  In `LiveMessage`, wrap the tool branch in `<Message role="agent">...</Message>`. Leave persisted
  content structure and protocol types untouched.

- [x] **Step 2: Render reasoning through Markdown**

  Replace the `Text tone="muted"` child of the reasoning `Disclosure` in both persisted and live paths
  with `<Markdown text={...} />`. Preserve the existing summary and collapsed-by-default behavior.

- [x] **Step 3: Render streamed text through Markdown**

  Update `StreamingText` to render `<Markdown text={text} />` while retaining the streaming wrapper,
  `aria-busy`, optional `aria-label`, and caret. Ensure the caret remains after the Markdown content,
  not inside the parsed model text.

- [x] **Step 4: Run focused tests and verify green**

  Run: `pnpm --filter @sovereign/web test -- src/sessions/session-message-list.test.tsx --run`
  and `pnpm --filter @sovereign/ui-kit test -- src/components/rendering.test.tsx --run`.

  Expected: all focused tests pass with zero failures.

### Task 3: Full verification and documentation consistency

**Files:**

- Modify: `docs/ui-kit.md` to remove the now-invalid claim that streaming text is intentionally flat and document the accepted experimental Markdown streaming behavior.
- Modify: `docs/sessions-and-projects.md` to document that live tool calls stay in the reading column without becoming separate records.
- Modify: `docs/roadmap.md` to mark the earlier flat-streaming statement as historical.

**Interfaces:**

- Consumes: the implementation and focused regression tests from Tasks 1–2.
- Produces: repository documentation matching the actual UI contract and a verified branch.

- [x] **Step 1: Update the “Почему так” sections**

  Keep the historical rationale visible, but mark the owner-approved experiment as the current rule:
  streamed text and reasoning use `Markdown` immediately; performance mitigation is deferred to a
  separate future slice.

- [x] **Step 2: Run package typechecks and full relevant tests**

  Run: `pnpm --filter @sovereign/ui-kit typecheck`, `pnpm --filter @sovereign/web typecheck`,
  `pnpm --filter @sovereign/ui-kit test -- --run`, and `pnpm --filter @sovereign/web test -- --run`.

- [x] **Step 3: Inspect the diff and commit**

  Run: `git diff --check` and `git status --short`, then commit with:
  `git add apps/web/src/sessions/session-message-list.tsx apps/web/src/sessions/session-message-list.test.tsx packages/ui-kit/src/components/streaming-text.tsx packages/ui-kit/src/components/streaming-text.module.css packages/ui-kit/src/components/rendering.test.tsx docs/ui-kit.md docs/sessions-and-projects.md docs/roadmap.md docs/superpowers/specs/2026-08-09-session-live-markdown-rendering-design.md docs/superpowers/plans/2026-08-09-session-live-markdown-rendering.md && git commit -m "fix(web): render live session content with markdown"`.
