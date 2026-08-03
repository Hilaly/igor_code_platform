# Sovereign Agent Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the session into the visual centre of Sovereign with a serif agent voice, compact human prompts, explicit machine-work blocks, and an elevated compact composer.

**Architecture:** Reuse `MessageFeed`, `Message`, `Markdown`, `StreamingText`, and `ToolCall`; evolve their styling and only the minimum props needed for richer machine-event summaries. Keep session state and ordering in the web app, while UI Kit owns typography, disclosure, status semantics, and machine-block geometry.

**Tech Stack:** React 19, TypeScript, CSS Modules, UI Kit, Vitest, Testing Library, Ladle, pnpm workspace.

## Global Constraints

- Start from the completed and reviewed visual-foundation and shell/system-view slices.
- Preserve session APIs, event ordering, pending/live/persisted deduplication, fork/label actions, archive behavior, queues, statistics, and model/thinking controls.
- Agent connected text uses Source Serif 4; human messages, controls, headers, reasoning labels, and service rows use Manrope.
- Tool names, commands, paths, arguments, output, logs, diffs, and build results use IBM Plex Mono.
- Colour is never the only indication of running/done/failed; status text remains visible while folded.
- Keep tool details folded by default and keyboard-operable through native `details`/`summary` semantics.
- Do not add right-panel functionality or change server payloads.
- Use test-first red/green cycles and atomic Conventional Commits in English.

---

## File Map

- `packages/ui-kit/src/components/message-feed.module.css`: readable centred feed, serif agent voice, compact human bubble, sans service rows.
- `packages/ui-kit/src/components/markdown.module.css`: inherit the agent voice while preserving code/table technical roles.
- `packages/ui-kit/src/components/streaming-text.module.css`: use the same voice while streaming.
- `packages/ui-kit/src/components/message-feed.test.ts`: keep scroll behavior unchanged.
- `packages/ui-kit/src/components/rendering.test.tsx`: protect message roles and rendered semantic structure.
- `packages/ui-kit/src/components/tool-call.tsx`: evolve the existing primitive with optional summary and duration while preserving required status/arguments.
- `packages/ui-kit/src/components/tool-call.module.css`: compact machine-event row and technical expanded content.
- `packages/ui-kit/src/components/interactive-components.test.tsx`: status visibility, disclosure, failure, duration, and output tests.
- `packages/ui-kit/src/components/chat.stories.tsx`: canonical full session state with human, agent, tools, streaming, service, and failure.
- `apps/web/src/sessions/session-message-list.tsx`: map session entries to the evolved `ToolCall` contract without changing order/state.
- `apps/web/src/sessions/session-message-list.test.tsx`: protect visible machine summaries and existing message actions.
- `apps/web/src/sessions/message-composer.test.tsx`: verify submit/delivery/interrupt behavior stays unchanged while CSS moves the surface.
- `apps/web/src/sessions/sessions.css`: remove chat card chrome, centre readable feed, elevate composer, compact metadata strips.
- `apps/web/src/shell/styles.test.ts`: protect session geometry.
- `docs/ui-kit.md`, `docs/README.md`: document the implemented session language and index the slice.

### Task 1: Editorial agent voice in MessageFeed

**Files:**

- Modify: `packages/ui-kit/src/components/message-feed.module.css`
- Modify: `packages/ui-kit/src/components/markdown.module.css`
- Modify: `packages/ui-kit/src/components/streaming-text.module.css`
- Modify: `packages/ui-kit/src/components/rendering.test.tsx`
- Modify: `packages/ui-kit/src/styles/styles.test.ts`

**Interfaces:**

- Preserves: `MessageFeedProps`, `MessageProps`, `MarkdownProps`, and `StreamingTextProps`.
- Produces: centred readable width, agent display/serif role, human body role, and machine code mono role.

- [ ] **Step 1: Add failing typography-role tests**

In the stylesheet contract, require:

```ts
expect(feedCss).toMatch(/\[data-role="agent"\][\s\S]*--sovereign-font-family-display/);
expect(feedCss).toMatch(/\[data-role="human"\][\s\S]*--sovereign-font-family-body/);
expect(markdownCss).toContain("font-family: inherit");
expect(streamingCss).toContain("font-family: var(--sovereign-font-family-display)");
```

In `rendering.test.tsx`, render one human, agent, and service message and assert the unchanged
`data-role` hooks and semantic `role="log"`/`aria-live` structure.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm --filter @sovereign/ui-kit test -- rendering.test.tsx styles.test.ts`

Expected: FAIL because all message bodies currently use the same body font and width.

- [ ] **Step 3: Implement contextual message typography**

Constrain the feed content to `--sovereign-reading-width` and centre it while keeping the scroll
container full width. Agent message body uses display/Source Serif and reading line height; human
message uses body/Manrope and a compact raised surface; service rows stay body/Manrope. Markdown
inherits the agent voice, but its `code`, `pre`, and technical table identifiers continue to use the
existing `Code`/mono styles.

- [ ] **Step 4: Run UI Kit message tests**

Run: `pnpm --filter @sovereign/ui-kit test -- message-feed.test.ts rendering.test.tsx styles.test.ts`

Expected: PASS, including unchanged stick-to-bottom behavior.

- [ ] **Step 5: Commit the agent voice**

```bash
git add packages/ui-kit/src/components/message-feed.module.css packages/ui-kit/src/components/markdown.module.css packages/ui-kit/src/components/streaming-text.module.css packages/ui-kit/src/components/rendering.test.tsx packages/ui-kit/src/styles/styles.test.ts
git commit -m "style(ui-kit): add editorial agent voice"
```

### Task 2: Rich compact ToolCall summary

**Files:**

- Modify: `packages/ui-kit/src/components/tool-call.tsx`
- Modify: `packages/ui-kit/src/components/tool-call.module.css`
- Modify: `packages/ui-kit/src/components/interactive-components.test.tsx`
- Modify: `packages/ui-kit/src/components/chat.stories.tsx`

**Interfaces:**

- Preserves required props: `toolName`, `status`, `statusLabel`, `argumentsText`.
- Adds optional props: `summary?: string`, `duration?: string`, `icon?: ReactNode`.
- Preserves optional output: `output?: string`, `outputLabel?: string`.
- Produces a folded summary containing icon/type, technical name/summary, visible status, and duration.

- [ ] **Step 1: Write failing primitive tests**

Add:

```tsx
render(
  <ToolCall
    icon="◇"
    toolName="read_file"
    summary="apps/web/src/App.tsx"
    duration="42 ms"
    status="done"
    statusLabel="Готово"
    argumentsText='{"path":"apps/web/src/App.tsx"}'
  />,
);

expect(screen.getByText("◇")).toBeTruthy();
expect(screen.getByText("apps/web/src/App.tsx")).toBeTruthy();
expect(screen.getByText("42 ms")).toBeTruthy();
expect(screen.getByText("Готово")).toBeTruthy();
expect(screen.getByText(/\"path\"/).closest("details")?.open).toBe(false);
```

Keep and rerun the existing failure-without-unfolding and late-output tests.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @sovereign/ui-kit test -- interactive-components.test.tsx`

Expected: TypeScript/test FAIL because the optional summary fields do not exist.

- [ ] **Step 3: Extend the primitive minimally**

Import `ReactNode`, add the three optional props, and render a summary grid:

```tsx
<span className={styles.summary}>
  {icon === undefined ? undefined : <span className={styles.icon}>{icon}</span>}
  <span className={styles.identity}>
    <Code>{toolName}</Code>
    {summary === undefined ? undefined : <span className={styles.description}>{summary}</span>}
  </span>
  <span className={styles.outcome}>
    {duration === undefined ? undefined : <Code>{duration}</Code>}
    <Badge tone={tones[status]}>{statusLabel}</Badge>
  </span>
</span>
```

Use mono for identity/duration/details, body font for translated status. Express failed state with
both failure text and danger border; running with visible text and an accent marker; done with
visible text and success/neutral semantics.

- [ ] **Step 4: Update the canonical chat story**

Show running, done with output, and failed tool calls between agent text blocks. Include a long path,
multiline output, and all three status labels.

- [ ] **Step 5: Run primitive verification**

Run:

```bash
pnpm --filter @sovereign/ui-kit test -- interactive-components.test.tsx rendering.test.tsx
pnpm --filter @sovereign/ui-kit typecheck
pnpm --filter @sovereign/ui-kit exec ladle build
```

Expected: PASS.

- [ ] **Step 6: Commit ToolCall evolution**

```bash
git add packages/ui-kit/src/components/tool-call.tsx packages/ui-kit/src/components/tool-call.module.css packages/ui-kit/src/components/interactive-components.test.tsx packages/ui-kit/src/components/chat.stories.tsx
git commit -m "feat(ui-kit): refine tool execution blocks"
```

### Task 3: Map session tool entries to the refined primitive

**Files:**

- Modify: `apps/web/src/sessions/session-message-list.tsx`
- Modify: `apps/web/src/sessions/session-message-list.test.tsx`

**Interfaces:**

- Consumes: optional `ToolCall.summary`, `duration`, and `icon` from Task 2.
- Preserves: session state shape and order.
- Produces: stable human-readable summaries derived only from already available tool name/input/output.

- [ ] **Step 1: Add failing session rendering tests**

Create persisted/live tool entries already supported by the state and assert:

```ts
expect(screen.getByText("write_file")).toBeTruthy();
expect(screen.getByText("hello.txt")).toBeTruthy();
expect(screen.getByText("Готово")).toBeTruthy();
```

For an unknown tool/input shape, assert fallback to the tool name without throwing or inventing a
summary. Keep the existing ordering and message-action tests in the same run.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @sovereign/web test -- session-message-list.test.tsx`

Expected: FAIL because the folded row exposes only the tool name/status.

- [ ] **Step 3: Add a pure local summary helper**

Inside `session-message-list.tsx`, add:

```ts
function toolSummary(toolName: string, input: unknown): string | undefined;
```

Return a path/command only when the existing input is a record with a non-empty string at `path`,
`file`, or `command`, in that order. Return `undefined` otherwise. Do not add domain-specific parsing
for tools not represented in the current data.

- [ ] **Step 4: Pass the summary and stable icon**

Use one neutral machine-work icon such as `◇` for now; status and failure remain textual. Do not
invent duration because current events do not provide it.

- [ ] **Step 5: Run session tests and typecheck**

Run: `pnpm --filter @sovereign/web test -- session-message-list.test.tsx state.test.ts && pnpm --filter @sovereign/web typecheck`

Expected: PASS.

- [ ] **Step 6: Commit integration**

```bash
git add apps/web/src/sessions/session-message-list.tsx apps/web/src/sessions/session-message-list.test.tsx
git commit -m "feat(web): summarize session tool execution"
```

### Task 4: Open chat surface and elevated composer

**Files:**

- Modify: `apps/web/src/sessions/sessions.css`
- Modify: `apps/web/src/shell/styles.test.ts`

**Interfaces:**

- Preserves: composer props, controlled draft, submit/append/follow-up/steer modes, interrupt action, statistics, queues, and session actions.
- Produces: chat with no enclosing card, compact metadata strips, readable feed, and elevated composer surface.

- [ ] **Step 1: Write failing session-layout assertions**

Replace the old card contract with:

```ts
expect(sessions).toMatch(/\.sessions-chat\s*\{[^}]*background:\s*transparent;/s);
expect(sessions).toMatch(/\.sessions-chat\s*\{[^}]*border:\s*none;/s);
expect(sessions).toMatch(
  /\.sessions-composer\s*\{[^}]*background:\s*var\(--sovereign-panel-surface\);/s,
);
expect(sessions).toMatch(
  /\.sessions-composer\s*\{[^}]*box-shadow:\s*var\(--sovereign-elevation-1\);/s,
);
```

Keep min-size, wrapping, and container-query assertions. In the same test file, add the permanent
application boundary now that this task removes its final current violation:

```ts
it.each(sheets)("$name leaves visual-system properties to UI Kit", ({ styles }) => {
  expect(styles).not.toMatch(/\bfont-family\s*:/);
  expect(styles).not.toMatch(/\bborder-radius\s*:/);
  expect(styles).not.toMatch(/\bbox-shadow\s*:/);
  expect(styles).not.toMatch(/(?:linear|radial|conic)-gradient\(/);
  expect(styles).not.toMatch(/\bbackdrop-filter\s*:/);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm --filter @sovereign/web test -- styles.test.ts message-composer.test.tsx`

Expected: FAIL because the entire chat is currently one bordered/radius panel and the composer is
only a top strip.

- [ ] **Step 3: Implement the session geometry**

Remove border/radius/panel background from `.sessions-chat`. Give metadata strips compact padding and
subtle separators. Give `.sessions-composer` panel surface, one strong border, moderate radius,
elevation 1, and an inline margin so it reads as the principal raised surface. Preserve wrapping and
first-child flex behavior.

- [ ] **Step 4: Run behavior and style verification**

Run:

```bash
pnpm --filter @sovereign/web test -- message-composer.test.tsx session-message-list.test.tsx styles.test.ts
pnpm --filter @sovereign/web typecheck
```

Expected: PASS with unchanged composer interactions.

- [ ] **Step 5: Commit the session surface**

```bash
git add apps/web/src/sessions/sessions.css apps/web/src/shell/styles.test.ts
git commit -m "style(web): focus the agent session surface"
```

### Task 5: Document and verify the agent-session slice

**Files:**

- Modify: `docs/ui-kit.md`
- Modify: `docs/README.md`

**Interfaces:**

- Documents: voice/interface/machine typography in the real session, ToolCall summary contract, open feed, and elevated composer.
- Produces: reviewed base for final application alignment.

- [ ] **Step 1: Update durable chat documentation**

Describe the visual/semantic roles without changing the already documented session data flow. Record
why agent text is serif, why human text remains sans, and why technical blocks alone use mono.

- [ ] **Step 2: Run complete verification**

Run:

```bash
pnpm --filter @sovereign/ui-kit test
pnpm --filter @sovereign/web test
pnpm --filter @sovereign/ui-kit typecheck
pnpm --filter @sovereign/web typecheck
pnpm eslint packages/ui-kit apps/web
pnpm prettier --check packages/ui-kit apps/web docs/ui-kit.md docs/README.md
pnpm --filter @sovereign/ui-kit exec ladle build
pnpm --filter @sovereign/web build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 3: Commit documentation**

```bash
git add docs/ui-kit.md docs/README.md
git commit -m "docs(chat): record refined agent session"
```

- [ ] **Step 4: Request independent review**

Dispatch a reviewer subagent with the spec, prerequisite slice commits, this plan, and the full diff.
Fix findings with focused tests and repeat review until no findings remain.
