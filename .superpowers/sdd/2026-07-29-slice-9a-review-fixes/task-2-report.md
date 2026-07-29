# Task 2: persisted session readability without runtime dependencies

## Status

Implemented and verified.

## RED

Command:

```text
pnpm --filter @sovereign/agent-runtime-pi test -- --test-name-pattern='reads a persisted session after its model disappears'
pnpm --filter @sovereign/daemon test -- --test-name-pattern='keeps persisted entries readable when the agent is gone'
```

Observed:

```text
runtime: 56 passed, 1 failed
Error: the session ... names the model scripted-model/scripted-model-1, which is gone
at liveSession (.../agent-session.ts:258:11)

daemon: 452 passed, 1 failed
AssertionError: 404 !== 200
at "keeps persisted entries readable when the agent is gone"
```

The runtime failure proved `AgentSessionStore.open()` constructed a live harness and resolved the
model even for persisted reads. The daemon failure proved `entries()` went through `openSession()`,
which required a currently contributed agent before opening JSONL.

## Interface and design change

`AgentSessionStore.open(id)` now returns `PersistedAgentSession`, which owns only:

- `summary()`
- `entries(after?)`
- `activate(agent)`

Opening and reading JSONL no longer resolve an agent or model. `activate(agent)` is the only boundary
that constructs `AgentHarness`; it returns `{ kind: "unknown-model" }` when the stored model is not
currently present.

The daemon reads entries directly from the persisted handle. Prompting still uses the existing
single-flight `opening` map, but its outcome now distinguishes:

- unknown session;
- unavailable named dependency;
- opened live session.

Missing agent/model therefore returns HTTP 409 with its identifier. No live session is cached after
the refusal, so returning dependencies can activate and prompt the same persisted session later.

## GREEN

Fresh verification after formatting:

```text
pnpm --filter @sovereign/agent-runtime-pi test
57 tests, 57 passed, 0 failed

pnpm --filter @sovereign/daemon test
453 tests, 453 passed, 0 failed

pnpm --filter @sovereign/agent-runtime-pi typecheck
exit 0

pnpm --filter @sovereign/daemon typecheck
exit 0

pnpm exec eslint packages/agent-runtime-pi/src/agent-session.ts \
  packages/agent-runtime-pi/src/agent-session.test.ts \
  apps/daemon/src/sessions.ts apps/daemon/src/sessions.test.ts
exit 0

pnpm exec prettier --check packages/agent-runtime-pi/src/agent-session.ts \
  packages/agent-runtime-pi/src/agent-session.test.ts \
  apps/daemon/src/sessions.ts apps/daemon/src/sessions.test.ts
All matched files use Prettier code style!

git diff --check
exit 0
```

`make check` was attempted twice. Typechecks and ESLint passed. The final repository-wide check stops
at an already present formatting warning in the task brief:

```text
[warn] .superpowers/sdd/2026-07-29-slice-9a-review-fixes/task-2-brief.md
make: *** [fmt-check] Error 1
```

The task's four changed source/test files pass focused Prettier verification.

## Files

- `packages/agent-runtime-pi/src/agent-session.ts`
- `packages/agent-runtime-pi/src/agent-session.test.ts`
- `apps/daemon/src/sessions.ts`
- `apps/daemon/src/sessions.test.ts`

## Self-review

- Persisted reads do not construct execution environments or harnesses.
- Missing model is a named outcome instead of an exception.
- Missing agent/model does not poison the single-flight map or live-session cache.
- Existing concurrent cold-open coverage still passes.
- Daemon regression coverage verifies list and entries remain readable, prompt returns 409 naming the
  missing agent, and the same session accepts a prompt after that agent returns.
- Runtime regression coverage verifies list and entries survive a missing model and activation gives
  the named model outcome.
- Scope stays within session persistence/runtime wiring; no lifecycle, startup, diagnostics, or docs
  changes were made.

## Concerns

The repository-wide formatting gate remains red only because `task-2-brief.md`, supplied as task
input and outside the implementation scope, is not Prettier-formatted. All changed product files are
formatted and verified.
