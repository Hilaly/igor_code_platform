# Mission Plugin and Browser Event Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a per-session `mission` built-in plugin with the `mission-update` tool, persistent snapshots, event invalidation, Mission right-panel UI, and a public browser-SDK bridge over the existing single SSE/frontend bus.

**Architecture:** The plugin owns storage, validation, route, event declaration/publication, and browser panel. The web host continues to own one `/api/events` connection; `BrowserRuntimeProvider` exposes a readonly subscription bridge through `@sovereign/browser-sdk`, so plugin components never create `EventSource` or poll.

**Tech Stack:** TypeScript, Node test runner, Vitest + Testing Library, React 19, `@sovereign/sdk`, `@sovereign/browser-sdk`, `@sovereign/ui-kit`, existing plugin routes/events/storage, artifact payload builder.

## Global Constraints

- State is strictly per `sessionId`; no project-wide task manager.
- Tool id is `mission-update`; event declared id is `changed`, full bus type is `mission.changed`.
- Snapshot is the source of truth; event payload is `{ sessionId, revision }` invalidation only.
- Frontend must use the host-provided bridge; no polling and no second `EventSource`.
- Route is `GET /api/p/mission/:sessionId`, protected by the normal plugin-route session check.
- `revision` is monotonic per session and stale route responses must not replace newer state.
- New dependencies must be workspace packages already supported by artifact shipping, or the payload builder must be updated and tested in the same logical change.

---

### Task 1: Define the browser event bridge contract

**Files:**

- Modify: `packages/browser-sdk/src/runtime-context.tsx`
- Modify: `packages/browser-sdk/src/host.tsx`
- Modify: `packages/browser-sdk/src/index.tsx`
- Test: `packages/browser-sdk/src/host.test.tsx`
- Test: `packages/browser-sdk/src/browser-sdk.test.tsx`
- Modify: `packages/browser-sdk/src/commands.test.tsx`
- Modify: `packages/browser-sdk/src/tabs.test.tsx`
- Modify: `packages/browser-sdk/src/page.test.tsx`

**Interfaces:**

- Produce `BrowserEvent`/listener types representing the existing `BusStreamEvent` shape and a readonly `subscribe` function.
- Extend `BrowserRuntimeProviderProps` with a required readonly `events` bridge; update every existing provider test fixture to pass the fake bridge.
- Export `useSovereignEvents(): { subscribe(listener): () => void }` from the public root.
- The hook must throw a clear authoring error outside `BrowserRuntimeProvider`, matching existing SDK hook conventions.

- [ ] **Step 1: Write failing tests** for provider propagation, hook subscription/cleanup, and public-root export.
- [ ] **Step 2: Run** `pnpm --filter @sovereign/browser-sdk exec vitest run src/host.test.tsx src/browser-sdk.test.tsx`; expect failures because the bridge does not exist.
- [ ] **Step 3: Implement** the readonly context field, provider prop, hook, and public export without opening any network connection.
- [ ] **Step 4: Update all existing provider test helpers** in commands/tabs/page tests to pass a deterministic fake bridge, then run the full browser-sdk Vitest suite and typecheck; expect PASS.
- [ ] **Step 5: Commit** `feat(browser-sdk): expose host event bridge to plugins`.

### Task 2: Pass the existing frontend bus through the web host

**Files:**

- Modify: `apps/web/src/places/place-host.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/App.test.tsx`
- Test: `apps/web/src/places/place-host.test.tsx`

**Interfaces:**

- `BrowserRuntimeProvider` wrapper accepts `events: Pick<FrontendBus, "subscribe">`.
- `App` passes the existing `bus` instance to the provider exactly once.

- [ ] **Step 1: Add failing tests** proving provider receives the same bus instance used by stream consumers.
- [ ] **Step 2: Run** `pnpm --filter @sovereign/web exec vitest run src/App.test.tsx src/places/place-host.test.tsx`; expect failure.
- [ ] **Step 3: Implement** the prop plumbing only; do not create another stream or bus.
- [ ] **Step 4: Run** targeted tests and `pnpm --filter @sovereign/web run typecheck`; expect PASS.
- [ ] **Step 5: Commit** `feat(web): pass frontend event bus to plugin runtime`.

### Task 3: Add Mission snapshot validation and storage service

**Files:**

- Create: `plugins/mission/package.json`
- Create: `plugins/mission/tsconfig.json`
- Create: `plugins/mission/src/model.ts`
- Create: `plugins/mission/src/store.ts`
- Test: `plugins/mission/src/model.test.ts`
- Test: `plugins/mission/src/store.test.ts`

**Interfaces:**

- `MissionStep`, `MissionInput`, `MissionSnapshot` types.
- `validateMissionInput(value: unknown): MissionInput` trims strings and rejects empty mission/steps, empty plan, unknown keys/statuses, and more than one `in_progress`.
- `readMission(sessionId): Promise<MissionSnapshot | undefined>` and `writeMission(sessionId, input): Promise<MissionSnapshot>` use `@sovereign/sdk` storage keys `mission.<sessionId>`.
- `writeMission` increments the stored revision (starting at 1) and writes `updatedAt` as an ISO timestamp.

- [ ] **Step 1: Write failing model tests** for valid input, all validation failures, unknown keys, and one active step.
- [ ] **Step 2: Run** `pnpm --filter @sovereign/plugin-mission exec node --test src/model.test.ts`; expect failure.
- [ ] **Step 3: Implement** the validator with SDK `z` and a canonical serialized snapshot shape.
- [ ] **Step 4: Write failing store tests** for independent session keys, revision increments, reload reads, and storage failure propagation.
- [ ] **Step 5: Run** the store test; expect failure.
- [ ] **Step 6: Implement** the storage adapter using `storage.get`/`storage.set`, with no in-memory source of truth.
- [ ] **Step 7: Run** both test files and typecheck; expect PASS.
- [ ] **Step 8: Commit** `feat(mission): add validated per-session snapshots`.

### Task 4: Add Mission tool, route, event, and worker lifecycle

**Files:**

- Create: `plugins/mission/src/tools.ts`
- Create: `plugins/mission/src/routes.ts`
- Create: `plugins/mission/src/worker.ts`
- Test: `plugins/mission/src/tools.test.ts`
- Test: `plugins/mission/src/routes.test.ts`
- Test: `plugins/mission/src/worker.test.ts`

**Interfaces:**

- Tool `mission-update` accepts `MissionInput`; its invocation context supplies `sessionId`.
- Route `GET /api/p/mission/:sessionId` returns `200` JSON snapshot or `404` JSON error.
- Event descriptor `changed` has schema `{ sessionId: z.string(), revision: z.number().int().positive() }`.
- `activate` registers tool, route, and event before any publication; handler writes then publishes.

- [ ] **Step 1: Write failing tool tests** for successful replacement, context-derived session id, validation error, and no publication after storage failure.
- [ ] **Step 2: Run** `pnpm --filter @sovereign/plugin-mission exec node --test src/tools.test.ts`; expect failure.
- [ ] **Step 3: Implement** tool handler and event publication after `writeMission` resolves.
- [ ] **Step 4: Write failing route tests** for snapshot, missing mission, and route registration.
- [ ] **Step 5: Run** route tests; expect failure.
- [ ] **Step 6: Implement** route handler using the session parameter only for reading; keep normal route protection in the host dispatcher.
- [ ] **Step 7: Write failing worker test** asserting contribution ids and event declaration.
- [ ] **Step 8: Implement** `activate` and optional `deactivate` with no important worker memory.
- [ ] **Step 9: Run** all mission backend tests and typecheck; expect PASS.
- [ ] **Step 10: Commit** `feat(mission): add mission-update tool and snapshot route`.

### Task 5: Build the Mission panel with event-driven refresh

**Files:**

- Create: `plugins/mission/src/browser.tsx`
- Create: `plugins/mission/src/mission-panel.tsx`
- Create: `plugins/mission/src/api.ts`
- Create: `plugins/mission/src/mission-panel.css`
- Test: `plugins/mission/src/mission-panel.test.tsx`

**Interfaces:**

- Browser export `MissionPanel({ context: PlaceContext }): ReactNode`.
- `fetchMission(sessionId): Promise<MissionSnapshot | undefined>` maps `404` to empty state and other failures to error state.
- Panel uses `useSovereignEvents`, filters `mission.changed` by `context.subject?.sessionId`, then refetches.
- Panel keeps the highest seen revision and ignores lower responses.

- [ ] **Step 1: Write failing component tests** for no session, loading, empty, error, success, progress, and active-step rendering.
- [ ] **Step 2: Add tests** proving a matching event reloads, a different session event does not, stale revisions are ignored, and unsubscribe runs on unmount.
- [ ] **Step 3: Run** `pnpm --filter @sovereign/plugin-mission exec vitest run src/mission-panel.test.tsx`; expect failure.
- [ ] **Step 4: Implement** route fetch, event subscription, request sequencing/revision guard, and UI with existing UI-kit primitives.
- [ ] **Step 5: Add manifest browser entry and `core.panel.tabs` component contribution in `worker.ts`.
- [ ] **Step 6: Run** Mission browser tests, worker tests, typecheck, and format check; expect PASS.
- [ ] **Step 7: Commit** `feat(mission): add event-driven Mission panel`.

### Task 6: Verify new built-ins in artifact payload

**Files:**

- Test: `apps/daemon/scripts/builtin-plugins-payload.test.ts`
- Test: `apps/daemon/src/platform/builtin-plugins.test.ts`
- Modify: `docs/toolchain.md`

**Interfaces:**

- Mission declares only `@sovereign/sdk` as a runtime dependency; `@sovereign/browser-sdk` and `@sovereign/ui-kit` remain browser host/dev dependencies, matching `subagents` and `hostModuleSpecifiers`.
- Existing discovery-based payload assembly must include `mission` and its worker/browser sources without a second built-in root or special-case loader.

- [ ] **Step 1: Add failing fixture assertions** that the payload contains `mission/package.json`, worker, browser source, and Mission assets while still excluding tests/configs; assert platform unpacking restores the plugin directory.
- [ ] **Step 2: Run** the focused payload and unpack tests; expect failure until the new plugin exists in the source tree.
- [ ] **Step 3: Add only the Mission package metadata needed for the existing discovery-based builder; do not add browser SDK/UI to runtime dependencies.
- [ ] **Step 4: Run** targeted payload tests and `make build`; expect PASS.
- [ ] **Step 5: Document** that browser singleton packages remain host-provided and are not shipped beside built-in plugin workers.
- [ ] **Step 6: Commit** `build(artifact): include mission plugin in payload`.

### Task 7: Verify Mission integration and document its public contract

**Files:**

- Modify: `docs/plugins.md`
- Modify: `docs/event-bus.md`
- Modify: `docs/ui-extension-model.md`
- Modify: `docs/web-api.md`
- Modify: `docs/README.md`
- Test: `plugins/mission/src/integration.test.ts` (create if the existing integration harness requires a dedicated fixture)

- [ ] **Step 1: Add an integration test** that activates Mission, invokes `mission-update`, reads the plugin route, and observes `mission.changed` payload.
- [ ] **Step 2: Run** the focused daemon/plugin integration test; expect failure before wiring is complete.
- [ ] **Step 3: If the integration test exposes a missing public route/test-harness adapter, add that adapter in the plugin or existing plugin test seam; do not modify core contracts.
- [ ] **Step 4: Update docs** with tool, route, event invalidation, browser bridge, and no-polling rules plus a “Почему так” section where the contract is documented.
- [ ] **Step 5: Run** `make check` and `make build`; expect PASS.
- [ ] **Step 6: Commit** `docs(mission): document Mission plugin contract`.

## Final Verification

- [ ] Run `make check`.
- [ ] Run `make build`.
- [ ] Confirm no Mission browser code imports `EventSource` or uses interval polling.
- [ ] Confirm artifact payload includes `mission`, its browser bundle resources, and required built workspace packages.
- [ ] Run a browser smoke test with an open session: update Mission, observe right-panel refresh without page reload, switch sessions, and confirm isolation.
