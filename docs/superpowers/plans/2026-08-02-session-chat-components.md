# Session Chat Components Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the session message feed and controlled message composer from `ChatView` without changing user-visible behavior.

**Architecture:** `ChatView` remains the coordinator for the open-session panel and owns the message draft so `EntryTreeDrawer` can replace it after navigation. `MessageComposer` owns only its delivery-mode selection and emits controlled draft changes; `SessionMessageList` owns feed derivation and rendering, including entry actions and label editing. Both remain feature components under `apps/web/src/sessions` and make no requests of their own.

**Tech Stack:** TypeScript, React 19, Vitest, Testing Library, `@sovereign/protocol`, `@sovereign/ui-kit`.

## Global Constraints

- Preserve every existing session-screen behavior and translation key.
- Keep `draft` state in `ChatView` and pass `draft` plus `onDraftChange` to `MessageComposer`.
- Keep session HTTP/API calls outside all view components.
- Keep both extracted components in `apps/web/src/sessions`; do not add UI-kit primitives or dependencies.
- Preserve the feed order: persisted active-branch entries, pending turns, then live items.
- Preserve first-live-prompt deduplication without hiding later steering that repeats an earlier human message.
- Follow TDD: add the direct component test, observe the expected failure, then add production code.
- End each task with passing focused tests, the existing `sessions-view.test.tsx`, web typechecking, and an atomic commit.

---

### Task 1: Extract the controlled message composer

**Files:**

- Create: `apps/web/src/sessions/message-composer.tsx`
- Create: `apps/web/src/sessions/message-composer.test.tsx`
- Modify: `apps/web/src/sessions/chat-view.tsx:12-370`

**Interfaces:**

- Consumes: `SessionMessage`, `SessionMessageMode`, and `ScopedTranslator`; callbacks already received by `ChatView`.
- Produces:

```ts
export type MessageComposerProps = {
  draft: string;
  onDraftChange: (draft: string) => void;
  busy: boolean;
  onSubmit: (text: string) => void;
  onSendMessage: (message: SessionMessage) => Promise<string | undefined>;
  onInterrupt: () => void;
  translator: ScopedTranslator;
};

export function MessageComposer(props: MessageComposerProps): React.JSX.Element;
```

- `ChatView` remains responsible for hiding the component when the session is archived and passes its `draft`/`setDraft` pair directly.

- [ ] **Step 1: Write the failing direct component tests**

Create `message-composer.test.tsx` with a stateful harness that renders `MessageComposer`. Prove these component-boundary behaviors through the DOM:

```tsx
it("reports draft changes through its controlled interface", () => {
  // Type through the textarea and assert that the harness displays the updated controlled value.
});

it("submits an idle draft and asks its owner to clear it", () => {
  // Type "привет", click "Отправить", assert onSubmit("привет") and an empty textarea.
});

it("owns the delivery mode while the session is busy", () => {
  // Select follow-up, send "продолжай", and assert { text: "продолжай", mode: "follow-up" }.
});

it("offers append only while idle and interrupt only while busy", () => {
  // Assert append calls mode "append" in idle state, rerender busy, then assert interrupt.
});
```

- [ ] **Step 2: Run the direct test and verify RED**

Run:

```bash
pnpm --filter @sovereign/web test -- src/sessions/message-composer.test.tsx
```

Expected: FAIL because `./message-composer.tsx` does not exist. Do not add production code before recording this failure in the task report.

- [ ] **Step 3: Implement the minimal controlled component**

Move `busyModes`, delivery-mode state, the mode selector, textarea, send/append decisions, draft clearing, and interrupt button from `ChatView` into `message-composer.tsx`. Use `props.onDraftChange("")` after a non-empty send or append. Keep raw draft text on submission and use `trim()` only to reject/disable empty input, matching current behavior.

- [ ] **Step 4: Integrate it into `ChatView`**

Remove the moved UI-kit imports and inline composer code. Render:

```tsx
{
  archived ? undefined : (
    <MessageComposer
      draft={draft}
      onDraftChange={setDraft}
      busy={busy}
      onSubmit={onSubmit}
      onSendMessage={onSendMessage}
      onInterrupt={onInterrupt}
      translator={translator}
    />
  );
}
```

Keep `<EntryTreeDrawer onEditorText={setDraft} />` unchanged so navigation still fills the same controlled draft.

- [ ] **Step 5: Verify GREEN and integration**

Run:

```bash
pnpm --filter @sovereign/web test -- src/sessions/message-composer.test.tsx src/sessions/sessions-view.test.tsx
pnpm --filter @sovereign/web typecheck
```

Expected: both test files pass and typechecking exits 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/sessions/message-composer.tsx apps/web/src/sessions/message-composer.test.tsx apps/web/src/sessions/chat-view.tsx
git commit -m "refactor(web): extract the session message composer" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 2: Extract the session message list

**Files:**

- Create: `apps/web/src/sessions/session-message-list.tsx`
- Create: `apps/web/src/sessions/session-message-list.test.tsx`
- Modify: `apps/web/src/sessions/chat-view.tsx:12-644`

**Interfaces:**

- Consumes: the `OpenSession` snapshot and existing callbacks for fork and entry labels.
- Produces:

```ts
export type SessionMessageListProps = {
  open: OpenSession;
  busy: boolean;
  archived: boolean;
  onFork: (request: SessionForkRequest) => Promise<void>;
  onSetLabel: (entryId: string, label: string | null) => Promise<string | undefined>;
  translator: ScopedTranslator;
};

export function SessionMessageList(props: SessionMessageListProps): React.JSX.Element;
```

- Owns its label-editor dialog and label-refusal notice because both originate from message-row actions.
- Leaves turn-failure/degradation notices, stats, context, queue badges, tree, session fork, and compaction in `ChatView`.

- [ ] **Step 1: Write the failing direct component tests**

Create `session-message-list.test.tsx` using a minimal `OpenSession` fixture. Prove these component-boundary behaviors through the DOM:

```tsx
it("renders persisted entries, pending turns, and live items in that order", () => {
  // Use three unique texts and compare their element positions.
});

it("deduplicates the persisted first prompt but keeps repeated steering", () => {
  // Persist "привет" and provide two live user messages with that text; expect two visible copies.
});

it("keeps message actions and label editing with the list", async () => {
  // Open a message label menu, save a label, and assert onSetLabel(entryId, label).
});

it("does not offer writing actions for archived messages", () => {
  // Assert label actions are absent while persisted content remains readable.
});
```

- [ ] **Step 2: Run the direct test and verify RED**

Run:

```bash
pnpm --filter @sovereign/web test -- src/sessions/session-message-list.test.tsx
```

Expected: FAIL because `./session-message-list.tsx` does not exist. Do not add production code before recording this failure in the task report.

- [ ] **Step 3: Implement the minimal list component**

Move from `ChatView` into `session-message-list.tsx`:

- tool-result lookup;
- active-branch/feed filtering;
- pending and live ordering and first-prompt deduplication;
- loading and empty states around `MessageFeed`;
- `EntryMessage`, `ContentBlock`, and `LiveMessage`;
- label-dialog state, label request, its refusal notice, and row-level fork/label callbacks.

Preserve existing comments that explain non-obvious ordering, streaming markdown, archive behavior, and fork positions.

- [ ] **Step 4: Integrate it into `ChatView`**

Replace the inline feed and label dialog with:

```tsx
<SessionMessageList
  open={open}
  busy={busy}
  archived={archived}
  onFork={onFork}
  onSetLabel={onSetLabel}
  translator={translator}
/>
```

Remove only imports, state, helpers, and refusal handling now owned by the list. Keep compaction refusal local to `ChatView` and preserve its translated notice.

- [ ] **Step 5: Verify GREEN and integration**

Run:

```bash
pnpm --filter @sovereign/web test -- src/sessions/session-message-list.test.tsx src/sessions/message-composer.test.tsx src/sessions/sessions-view.test.tsx
pnpm --filter @sovereign/web typecheck
```

Expected: all three test files pass and typechecking exits 0.

- [ ] **Step 6: Run feature-wide verification**

Run:

```bash
pnpm --filter @sovereign/web test
pnpm exec eslint apps/web/src/sessions
pnpm exec prettier --check apps/web/src/sessions
```

Expected: the whole web suite passes, ESLint exits 0, and Prettier reports all matched files formatted.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/sessions/session-message-list.tsx apps/web/src/sessions/session-message-list.test.tsx apps/web/src/sessions/chat-view.tsx
git commit -m "refactor(web): extract the session message list" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 3: Verify the complete refactor

**Files:**

- Modify only if a verification failure exposes a regression in files changed by Tasks 1–2.

**Interfaces:**

- Consumes: the two extracted components integrated by `ChatView`.
- Produces: a branch whose complete repository checks and web production build pass.

- [ ] **Step 1: Run the full repository check**

```bash
make check
```

Expected: typechecking, ESLint, Prettier, and every package test exit 0.

- [ ] **Step 2: Run the production build**

```bash
make build
```

Expected: every package with a build script succeeds and the web Vite production bundle is emitted without errors.

- [ ] **Step 3: Record verification**

If no code changes were needed, do not create an empty commit. Record commands, exit codes, and test counts in the task report and SDD ledger. If an in-scope regression required a change, first add a failing regression test, observe RED, implement the minimal fix, repeat both commands, and commit atomically with the required co-author trailer.
