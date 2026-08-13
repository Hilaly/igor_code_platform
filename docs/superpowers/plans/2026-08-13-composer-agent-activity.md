# Composer Agent Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the non-idle session phase, locally elapsed busy time, and total session tokens in a dedicated row above the composer, led by the approved three-orbit Sovereign mark.

**Architecture:** Add a presentation-only `OrbitingBrandMark` primitive to UI Kit, then keep session meaning and the local clock in a focused `AgentActivity` component under `apps/web/src/sessions`. `ChatView` passes the existing phase and statistics into that component and places it as a sibling immediately before `MessageComposer`; neither the protocol nor the composer surface changes.

**Tech Stack:** React 19, TypeScript, CSS Modules in UI Kit, application layout CSS, Vitest, Testing Library, Intl number formatting, pnpm 11.

## Global Constraints

- The activity row is a separate row above the composer and must never be rendered inside `RaisedSurface`, `MessageComposer`, its textarea, or its toolbar.
- Render nothing and reserve no space for `phase === "idle"`; render `queued`, `turn`, `compaction`, `branch-summary`, and `retry`.
- Start the client clock at zero when an already-busy session is opened or the page reloads; do not add a server timestamp, persistence, polling, or a protocol field.
- Keep one start time across non-idle phase changes; reset on `idle`, a new non-idle period, or a different `sessionId`.
- Display `SessionStats.totalTokens`, not current-branch context tokens and not an inferred current-turn count; omit the token fragment when statistics are unavailable.
- Keep the existing phase in the global shell header and keep the existing circular `SessionUsage` control in the composer toolbar.
- The Sovereign image remains stationary. Gold/orange, green, and red sparks orbit with different radii, speeds, directions, and offsets, matching the approved visual-companion option C.
- Use UI-kit semantic colour roles (`warning`, `success`, `danger`) and existing size/spacing tokens; do not introduce literal application colours or a dependency.
- With `prefers-reduced-motion: reduce`, stop all three animations but leave the mark and three sparks visibly separated.
- The activity has `role="status"`, a complete `aria-label`, and explicit `aria-live="off"`; the timer must not cause a live announcement every second.
- Do not stop or replace the current visual-companion server before Task 3 visual verification. The selected source is `.superpowers/brainstorm/77313-1786630042/content/brand-animation-options-v2.html`, option `three-orbits`; `.superpowers/` remains ignored and is not committed.
- Follow TDD: observe every new test fail for the intended reason before implementing production code.
- Each task ends in a small Conventional Commit and leaves its affected package tests green.

## File Structure

- `packages/ui-kit/src/components/orbiting-brand-mark.tsx` — decorative brand-plus-orbits markup only; no session concepts.
- `packages/ui-kit/src/components/orbiting-brand-mark.module.css` — three independent orbit tracks, semantic colours, and reduced-motion fallback.
- `packages/ui-kit/src/components/rendering.test.tsx` — static markup and accessibility boundary of the new primitive.
- `packages/ui-kit/src/styles/styles.test.ts` — animation, semantic-token, and reduced-motion CSS contract.
- `packages/ui-kit/src/components/primitives.stories.tsx` — catalogue example used for theme/scale inspection.
- `packages/ui-kit/src/index.ts` — public export for application and plugins.
- `apps/web/src/sessions/agent-activity.tsx` — idle gate, keyed busy clock, localized duration, compact total tokens, and status semantics.
- `apps/web/src/sessions/agent-activity.test.tsx` — phase, clock, session reset, token, and accessibility behavior.
- `apps/web/src/sessions/chat-view.tsx` — supplies existing `open.id`, `open.summary.phase`, and `open.stats.totalTokens`; places the row before the composer.
- `apps/web/src/sessions/chat-view.test.tsx` — integration boundary and DOM ordering outside `RaisedSurface`.
- `apps/web/src/sessions/sessions.css` — reader-width alignment and single-line truncation only; the UI-kit primitive owns the animated visual.
- `apps/web/src/shell/styles.test.ts` — application layout contract for the new row.
- `packages/ui-kit/src/i18n/messages/en.ts` and `packages/ui-kit/src/i18n/messages/ru.ts` — localized token unit in the activity sentence.
- `docs/ui-kit.md` — public primitive contract and motion fallback.
- `docs/sessions-and-projects.md` — behavior of the lower session work area, local timer, and total-token meaning.

---

### Task 1: Orbiting Sovereign Mark Primitive

**Files:**

- Create: `packages/ui-kit/src/components/orbiting-brand-mark.tsx`
- Create: `packages/ui-kit/src/components/orbiting-brand-mark.module.css`
- Modify: `packages/ui-kit/src/components/rendering.test.tsx`
- Modify: `packages/ui-kit/src/styles/styles.test.ts`
- Modify: `packages/ui-kit/src/components/primitives.stories.tsx`
- Modify: `packages/ui-kit/src/index.ts`
- Modify: `docs/ui-kit.md`

**Interfaces:**

- Consumes: `BrandMark({ size?: IconSize })` and UI-kit properties `--sovereign-warning`, `--sovereign-success`, `--sovereign-danger`, `--sovereign-icon-*`, and `--sovereign-space-*`.
- Produces: `OrbitingBrandMark({ size?: IconSize }): React.JSX.Element`, always decorative and containing exactly three sparks identified by `data-orbit="gold" | "green" | "red"`.

- [ ] **Step 1: Write failing rendering tests for the decorative mark and its three tracks**

Add `OrbitingBrandMark` to the import list in `packages/ui-kit/src/components/rendering.test.tsx`, then add:

```tsx
it("keeps the orbiting brand decorative and gives every spark its own track", () => {
  const markup = renderToStaticMarkup(<OrbitingBrandMark size="md" />);

  expect(markup).toContain('aria-hidden="true"');
  expect(markup).toContain('data-orbit="gold"');
  expect(markup).toContain('data-orbit="green"');
  expect(markup).toContain('data-orbit="red"');
  expect(markup.match(/data-orbit=/g)).toHaveLength(3);
  expect(markup).toContain('src="');
  expect(markup).not.toContain('role="status"');
});
```

- [ ] **Step 2: Write the failing CSS contract test**

In `packages/ui-kit/src/styles/styles.test.ts`, read `orbiting-brand-mark.module.css` and assert the approved three-track properties:

```ts
it("gives the Sovereign activity mark three semantic independent orbits", () => {
  const activity = withoutComments(
    readFileSync(join(kitRoot, "components", "orbiting-brand-mark.module.css"), "utf8"),
  );

  expect(activity).toMatch(
    /\.gold\s*\{[^}]*--orbit-color:\s*var\(--sovereign-warning\);[^}]*animation-duration:\s*1\.25s;/s,
  );
  expect(activity).toMatch(
    /\.green\s*\{[^}]*--orbit-color:\s*var\(--sovereign-success\);[^}]*animation-duration:\s*1\.85s;[^}]*animation-direction:\s*reverse;/s,
  );
  expect(activity).toMatch(
    /\.red\s*\{[^}]*--orbit-color:\s*var\(--sovereign-danger\);[^}]*animation-duration:\s*2\.45s;/s,
  );
  expect(activity).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.spark/s);
  expect(activity).not.toMatch(/#[0-9a-f]{3,8}|rgb\(/i);
});
```

- [ ] **Step 3: Run the focused UI-kit tests and verify the intended failure**

Run:

```bash
pnpm --filter @sovereign/ui-kit exec vitest run src/components/rendering.test.tsx src/styles/styles.test.ts
```

Expected: FAIL because `OrbitingBrandMark` and `orbiting-brand-mark.module.css` do not exist.

- [ ] **Step 4: Implement the minimal public primitive**

Create `packages/ui-kit/src/components/orbiting-brand-mark.tsx`:

```tsx
import { BrandMark, type SymbolIconProps } from "./icons.tsx";
import styles from "./orbiting-brand-mark.module.css";

export function OrbitingBrandMark({ size = "md" }: SymbolIconProps): React.JSX.Element {
  return (
    <span className={styles.root} aria-hidden="true">
      <span className={styles.mark}>
        <BrandMark size={size} />
      </span>
      <span className={`${styles.spark} ${styles.gold}`} data-orbit="gold" />
      <span className={`${styles.spark} ${styles.green}`} data-orbit="green" />
      <span className={`${styles.spark} ${styles.red}`} data-orbit="red" />
    </span>
  );
}
```

Create `packages/ui-kit/src/components/orbiting-brand-mark.module.css` with the geometry of the approved option C, expressed through UI-kit tokens:

```css
.root {
  position: relative;
  display: inline-grid;
  place-items: center;
  flex: none;
  overflow: visible;
}

.mark {
  z-index: 1;
  display: inline-grid;
  place-items: center;
}

.spark {
  position: absolute;
  inset-block-start: 50%;
  inset-inline-start: 50%;
  inline-size: var(--sovereign-space-1);
  block-size: var(--sovereign-space-1);
  margin-block-start: calc(var(--sovereign-space-1) / -2);
  margin-inline-start: calc(var(--sovereign-space-1) / -2);
  border-radius: 50%;
  background: var(--orbit-color);
  box-shadow: 0 0 var(--sovereign-space-2) var(--orbit-color);
  animation-name: orbit;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}

.gold {
  --orbit-color: var(--sovereign-warning);
  --orbit-radius: calc(var(--sovereign-icon-md) * 0.55);
  animation-duration: 1.25s;
}

.green {
  --orbit-color: var(--sovereign-success);
  --orbit-radius: calc(var(--sovereign-icon-md) * 0.45);
  animation-duration: 1.85s;
  animation-delay: -0.7s;
  animation-direction: reverse;
}

.red {
  --orbit-color: var(--sovereign-danger);
  --orbit-radius: calc(var(--sovereign-icon-md) * 0.6);
  animation-duration: 2.45s;
  animation-delay: -1.4s;
}

@keyframes orbit {
  from {
    transform: rotate(0deg) translateX(var(--orbit-radius)) rotate(0deg);
  }
  to {
    transform: rotate(360deg) translateX(var(--orbit-radius)) rotate(-360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .spark {
    animation: none;
  }
  .gold {
    transform: rotate(15deg) translateX(var(--orbit-radius));
  }
  .green {
    transform: rotate(145deg) translateX(var(--orbit-radius));
  }
  .red {
    transform: rotate(265deg) translateX(var(--orbit-radius));
  }
}
```

If visual inspection shows that the fixed `md` orbit radii do not scale acceptably for another requested `size`, add a root `data-size` map in this task rather than reading CSS-module class names from application code. Do not move orbit geometry to `apps/web`.

- [ ] **Step 5: Export and catalogue the primitive**

Add this public export to `packages/ui-kit/src/index.ts`:

```ts
export * from "./components/orbiting-brand-mark.tsx";
```

Add an `OrbitingBrandMark` example next to the existing brand examples in `packages/ui-kit/src/components/primitives.stories.tsx`:

```tsx
<OrbitingBrandMark size="md" />
```

Document the primitive next to `BrandMark` in `docs/ui-kit.md`: it is decorative, its mark is stationary, its three semantic-colour sparks move independently, and reduced motion freezes them at separate positions.

- [ ] **Step 6: Run UI-kit tests, typecheck, and format verification**

Run:

```bash
pnpm exec prettier --write packages/ui-kit/src/components/orbiting-brand-mark.tsx packages/ui-kit/src/components/orbiting-brand-mark.module.css packages/ui-kit/src/components/rendering.test.tsx packages/ui-kit/src/styles/styles.test.ts packages/ui-kit/src/components/primitives.stories.tsx packages/ui-kit/src/index.ts docs/ui-kit.md
pnpm --filter @sovereign/ui-kit exec vitest run src/components/rendering.test.tsx src/styles/styles.test.ts
pnpm --filter @sovereign/ui-kit run typecheck
```

Expected: all commands PASS; the rendering output contains one decorative Sovereign image and exactly three orbit markers.

- [ ] **Step 7: Commit the UI-kit primitive**

```bash
git add packages/ui-kit/src/components/orbiting-brand-mark.tsx packages/ui-kit/src/components/orbiting-brand-mark.module.css packages/ui-kit/src/components/rendering.test.tsx packages/ui-kit/src/styles/styles.test.ts packages/ui-kit/src/components/primitives.stories.tsx packages/ui-kit/src/index.ts docs/ui-kit.md
git commit -m "feat(ui-kit): add orbiting Sovereign mark"
```

### Task 2: Session Agent Activity and Local Busy Clock

**Files:**

- Create: `apps/web/src/sessions/agent-activity.tsx`
- Create: `apps/web/src/sessions/agent-activity.test.tsx`
- Modify: `packages/ui-kit/src/i18n/messages/en.ts`
- Modify: `packages/ui-kit/src/i18n/messages/ru.ts`

**Interfaces:**

- Consumes: `OrbitingBrandMark`, `SessionPhase`, optional `SessionStats.totalTokens`, existing `formatUptime(totalSeconds, units)`, and a full UI-kit `Translator` so compact numbers follow the active locale.
- Produces: `AgentActivity({ sessionId, phase, totalTokens?, translator }): React.JSX.Element | null`. A keyed inner component owns the start time so non-idle phase changes do not reset it and `idle` unmounts it.

- [ ] **Step 1: Write the failing phase and token tests**

Create `apps/web/src/sessions/agent-activity.test.tsx` with the repository's Russian translator fixture and these cases:

```tsx
it.each(["queued", "turn", "compaction", "branch-summary", "retry"] as const)(
  "shows the %s phase outside idle",
  (phase) => {
    render(
      <AgentActivity sessionId="0199" phase={phase} totalTokens={11_000} translator={translator} />,
    );

    const status = screen.getByRole("status");
    expect(status.textContent).toContain(translator.t(`sessions.phase.${phase}`));
    expect(status.textContent).toContain(
      translator.t("chat.activity.tokens", {
        total: translator.formatNumber(11_000, {
          notation: "compact",
          maximumFractionDigits: 1,
        }),
      }),
    );
    expect(status.getAttribute("aria-live")).toBe("off");
  },
);

it("renders nothing in idle and omits an unknown token total", () => {
  const view = render(<AgentActivity sessionId="0199" phase="idle" translator={translator} />);
  expect(screen.queryByRole("status")).toBeNull();

  view.rerender(<AgentActivity sessionId="0199" phase="turn" translator={translator} />);
  expect(screen.getByRole("status").textContent).not.toContain("токен");
});
```

- [ ] **Step 2: Write the failing clock-lifecycle test**

In the same file, enable fake timers in the test and restore real timers in `afterEach`:

```tsx
it("keeps one clock across busy phases and resets it after idle or a session change", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-13T10:00:00.000Z"));
  const view = render(
    <AgentActivity sessionId="0199" phase="queued" totalTokens={11_000} translator={translator} />,
  );

  act(() => vi.advanceTimersByTime(53_000));
  expect(screen.getByRole("status").textContent).toContain("53 с");

  view.rerender(
    <AgentActivity sessionId="0199" phase="retry" totalTokens={11_000} translator={translator} />,
  );
  expect(screen.getByRole("status").textContent).toContain("53 с");

  view.rerender(
    <AgentActivity sessionId="0199" phase="idle" totalTokens={11_000} translator={translator} />,
  );
  expect(screen.queryByRole("status")).toBeNull();

  view.rerender(
    <AgentActivity sessionId="0199" phase="turn" totalTokens={11_000} translator={translator} />,
  );
  expect(screen.getByRole("status").textContent).toContain("0 с");

  act(() => vi.advanceTimersByTime(8_000));
  view.rerender(
    <AgentActivity sessionId="0200" phase="turn" totalTokens={200} translator={translator} />,
  );
  expect(screen.getByRole("status").textContent).toContain("0 с");
});
```

Add `vi.useRealTimers()` to `afterEach` so this file cannot leak a fake clock to other tests.

- [ ] **Step 3: Run the focused web test and verify the intended failure**

Run:

```bash
pnpm --filter @sovereign/web exec vitest run src/sessions/agent-activity.test.tsx
```

Expected: FAIL because `agent-activity.tsx` and `chat.activity.tokens` do not exist.

- [ ] **Step 4: Add the localized token fragment**

Add the following keys beside the existing session-stat strings:

```ts
// packages/ui-kit/src/i18n/messages/en.ts
"chat.activity.tokens": "{total} tokens",

// packages/ui-kit/src/i18n/messages/ru.ts
"chat.activity.tokens": "{total} токенов",
```

The phase and duration continue to use existing `sessions.phase.*` and `duration.*` messages; do not add a second translation for them.

- [ ] **Step 5: Implement the keyed active component**

Create `apps/web/src/sessions/agent-activity.tsx` with this boundary:

```tsx
import type { SessionPhase } from "@sovereign/protocol";
import { OrbitingBrandMark, Text, type Translator } from "@sovereign/ui-kit";
import { useEffect, useRef, useState } from "react";

import { formatUptime } from "../uptime.ts";

export type AgentActivityProps = {
  sessionId: string;
  phase: SessionPhase;
  totalTokens?: number;
  translator: Translator;
};

export function AgentActivity(props: AgentActivityProps): React.JSX.Element | null {
  if (props.phase === "idle") {
    return null;
  }

  return <ActiveAgentActivity key={props.sessionId} {...props} />;
}

function ActiveAgentActivity({ phase, totalTokens, translator }: AgentActivityProps) {
  const startedAt = useRef(Date.now());
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const update = (): void => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt.current) / 1_000)));
    };
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const duration = formatUptime(elapsedSeconds, {
    hours: (count) => translator.t("duration.hours", { count }),
    minutes: (count) => translator.t("duration.minutes", { count }),
    seconds: (count) => translator.t("duration.seconds", { count }),
  });
  const tokens =
    totalTokens === undefined
      ? undefined
      : translator.t("chat.activity.tokens", {
          total: translator.formatNumber(totalTokens, {
            notation: "compact",
            maximumFractionDigits: 1,
          }),
        });
  const label = [translator.t(`sessions.phase.${phase}`), duration, tokens]
    .filter((part): part is string => part !== undefined)
    .join(" · ");

  return (
    <div
      className="sessions-agent-activity"
      role="status"
      aria-live="off"
      aria-label={label}
      title={label}
    >
      <OrbitingBrandMark size="md" />
      <span className="sessions-agent-activity-text">
        <Text tone="muted">{label}</Text>
      </span>
    </div>
  );
}
```

The public wrapper's `idle` branch unmounts `ActiveAgentActivity`; non-idle phase updates retain the same component and `startedAt`; `key={sessionId}` remounts it for another session.

- [ ] **Step 6: Run the focused tests and package typechecks**

Run:

```bash
pnpm exec prettier --write apps/web/src/sessions/agent-activity.tsx apps/web/src/sessions/agent-activity.test.tsx packages/ui-kit/src/i18n/messages/en.ts packages/ui-kit/src/i18n/messages/ru.ts
pnpm --filter @sovereign/web exec vitest run src/sessions/agent-activity.test.tsx
pnpm --filter @sovereign/web run typecheck
pnpm --filter @sovereign/ui-kit run typecheck
```

Expected: all commands PASS; fake time proves phase continuity and both reset boundaries without waiting in real time.

- [ ] **Step 7: Commit the activity behavior**

```bash
git add apps/web/src/sessions/agent-activity.tsx apps/web/src/sessions/agent-activity.test.tsx packages/ui-kit/src/i18n/messages/en.ts packages/ui-kit/src/i18n/messages/ru.ts
git commit -m "feat(web): show active session progress"
```

### Task 3: Place Activity Above, Not Inside, the Composer

**Files:**

- Modify: `apps/web/src/sessions/chat-view.tsx`
- Modify: `apps/web/src/sessions/chat-view.test.tsx`
- Modify: `apps/web/src/sessions/sessions.css`
- Modify: `apps/web/src/shell/styles.test.ts`
- Modify: `docs/sessions-and-projects.md`

**Interfaces:**

- Consumes: `AgentActivity({ sessionId, phase, totalTokens?, translator })` from Task 2 and the existing `OpenSession.summary`, `OpenSession.stats`, and `MessageComposer` root `.sessions-composer-surface`.
- Produces: `ChatView` renders `.sessions-agent-activity` as the preceding sibling of `.sessions-composer-surface` inside `.sessions-chat-bottom`; `ChatViewProps.translator` narrows from `ScopedTranslator` to the existing full `Translator` passed by `App`.

- [ ] **Step 1: Write the failing ChatView placement test**

Add `act` to the Testing Library imports if the file needs fake-time assertions, restore real timers in `afterEach`, and add:

```tsx
it("puts busy activity above and outside the composer surface", () => {
  const busySummary = { ...summary, phase: "turn" as const };
  const view = show(
    openSession(busySummary, {
      stats: { ...openSession(summary).stats!, totalTokens: 11_000 },
    }),
  );

  const status = screen.getByRole("status", { name: /Идёт турн.*токенов/ });
  const composerSurface = view.container.querySelector(".sessions-composer-surface");
  const raisedSurface = view.container.querySelector(".sessions-composer");

  expect(status.classList.contains("sessions-agent-activity")).toBe(true);
  expect(status.parentElement?.classList.contains("sessions-chat-bottom")).toBe(true);
  expect(status.nextElementSibling).toBe(composerSurface);
  expect(composerSurface?.contains(status)).toBe(false);
  expect(raisedSurface?.contains(status)).toBe(false);
});

it("leaves no activity row or gap owner while idle or archived", () => {
  const idle = show(openSession(summary));
  expect(idle.container.querySelector(".sessions-agent-activity")).toBeNull();

  idle.rerender(
    <ShellHeaderProvider description={{ title: "Сессии" }}>
      <HeaderProbe />
      <ChatView {...idle.props} open={openSession({ ...summary, archived: true, phase: "idle" })} />
    </ShellHeaderProvider>,
  );
  expect(idle.container.querySelector(".sessions-agent-activity")).toBeNull();
  expect(idle.container.querySelector(".sessions-composer-surface")).toBeNull();
});
```

- [ ] **Step 2: Write the failing application-layout test**

Extend the existing `keeps the session bottom zone measurable...` case in `apps/web/src/shell/styles.test.ts`:

```ts
expect(sessions).toMatch(
  /\.sessions-agent-activity\s*\{[^}]*align-self:\s*center;[^}]*width:\s*min\(calc\(100%\s*-\s*2\s*\*\s*var\(--sovereign-space-3\)\),\s*var\(--sovereign-reading-width\)\);[^}]*min-width:\s*0;/s,
);
expect(sessions).toMatch(
  /\.sessions-agent-activity-text\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s,
);
expect(sessions).not.toMatch(/\.sessions-composer[^,{]*,\s*\.sessions-agent-activity/s);
```

The negative assertion prevents folding the activity into the composer selector or surface boundary.

- [ ] **Step 3: Run the integration and style tests and verify the intended failure**

Run:

```bash
pnpm --filter @sovereign/web exec vitest run src/sessions/chat-view.test.tsx src/shell/styles.test.ts
```

Expected: FAIL because `ChatView` does not render `AgentActivity` and no activity layout classes exist.

- [ ] **Step 4: Integrate the existing session data without changing MessageComposer**

In `apps/web/src/sessions/chat-view.tsx`:

1. Import `Translator` instead of `ScopedTranslator` for `ChatViewProps`.
2. Import `AgentActivity` from `./agent-activity.tsx`.
3. Inside the existing `archived ? undefined : (...)` branch, render a fragment whose first child is:

```tsx
<AgentActivity
  sessionId={open.id}
  phase={open.summary?.phase ?? "idle"}
  {...(open.stats === undefined ? {} : { totalTokens: open.stats.totalTokens })}
  translator={translator}
/>
```

4. Keep the existing `<MessageComposer ... />` unchanged as the fragment's second child.

Do not add `phase`, `stats`, elapsed time, or brand props to `MessageComposerProps`.

- [ ] **Step 5: Add only the host geometry to sessions.css**

Add before the existing composer block:

```css
.sessions-agent-activity {
  display: flex;
  align-items: center;
  align-self: center;
  gap: var(--sovereign-space-2);
  width: min(calc(100% - 2 * var(--sovereign-space-3)), var(--sovereign-reading-width));
  min-width: 0;
  padding-inline: var(--sovereign-space-1);
}

.sessions-agent-activity-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

Do not put background, border, radius, shadow, gradient, font family, literal colour, or animation in application CSS. `Text` and `OrbitingBrandMark` own appearance; these two selectors own placement and truncation.

- [ ] **Step 6: Run focused integration tests**

Run:

```bash
pnpm exec prettier --write apps/web/src/sessions/chat-view.tsx apps/web/src/sessions/chat-view.test.tsx apps/web/src/sessions/sessions.css apps/web/src/shell/styles.test.ts
pnpm --filter @sovereign/web exec vitest run src/sessions/agent-activity.test.tsx src/sessions/chat-view.test.tsx src/shell/styles.test.ts
pnpm --filter @sovereign/web run typecheck
```

Expected: PASS; DOM ordering proves the row is above and outside the composer, and idle produces no row.

- [ ] **Step 7: Update the durable session documentation**

In `docs/sessions-and-projects.md`, extend the existing lower-work-area description with these exact rules:

- non-idle activity is a separate sibling above the composer;
- it shows the localized phase, a client-only continuous-busy timer, and `SessionStats.totalTokens`;
- non-idle phase changes retain one start; idle, another session, or reload resets it;
- the timer is not a server duration and the token value is not current-turn usage;
- the global header phase and the circular context control remain.

Add a `Почему так` paragraph rejecting placement inside `RaisedSurface` and toolbar placement for the reasons in the approved design. Format the two changed documents:

```bash
pnpm exec prettier --write docs/sessions-and-projects.md docs/superpowers/specs/2026-08-13-composer-agent-activity-design.md
```

- [ ] **Step 8: Verify the approved animation in the live product**

Keep the visual-companion tab open. Start the product in a separate terminal:

```bash
make dev
```

Open a session and exercise at least `queued`, `turn`, and manual `compaction`. Compare the product against option C in the still-running companion and verify:

- the PNG itself does not rotate or pulse;
- three sparks are simultaneously visible and do not collapse into one track;
- gold/orange is fastest, green reverses at medium speed, red is slowest;
- the row is above the RaisedSurface with a visible gap and matching reading width;
- returning to idle removes the entire row without leaving vertical space;
- light and dark Imperium schemes keep all sparks visible;
- a narrow container truncates text, not the brand, and `title` retains the complete label;
- macOS Reduce Motion (or a browser emulation of `prefers-reduced-motion`) freezes three separated sparks.

If the product differs from the approved motion, adjust only orbit radii/durations/delays in `orbiting-brand-mark.module.css`, update the exact CSS expectations in `styles.test.ts`, and rerun Task 1 and Task 3 focused tests. Do not edit or replace the companion screen.

- [ ] **Step 9: Run the full repository verification**

Stop only the product dev process started in Step 8; leave the visual-companion server running as requested. Run:

```bash
make check
make build
git diff --check
git status --short
```

Expected: typecheck, ESLint, Prettier check, all package tests, recursive build, and whitespace validation PASS. `git status --short` lists only the intended Task 3 source, tests, and documentation before commit.

- [ ] **Step 10: Commit integration and documentation**

```bash
git add apps/web/src/sessions/chat-view.tsx apps/web/src/sessions/chat-view.test.tsx apps/web/src/sessions/sessions.css apps/web/src/shell/styles.test.ts docs/sessions-and-projects.md
git commit -m "feat(web): place agent activity above composer"
```

- [ ] **Step 11: Confirm final branch state without stopping the companion**

Run:

```bash
git status --short --branch
git log --oneline -4
test -f .superpowers/brainstorm/77313-1786630042/state/server-info
test ! -f .superpowers/brainstorm/77313-1786630042/state/server-stopped
```

Expected: the branch is clean, the three implementation commits follow the design/plan commits, and the visual-companion server is still marked running.
