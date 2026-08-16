# Starter Plugin SDK Skills Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update only `starter.plugin-backend` and `starter.plugin-frontend` so plugin authors use event-driven snapshots through the public SDK and never add polling or a second SSE connection.

**Architecture:** Documentation follows the already-approved Mission/browser bridge contract. Backend guidance explains storage, route, event declaration/publication, and revision snapshots; frontend guidance explains the public browser bridge, session context, event invalidation, and route reload. No worker code or new runtime behavior belongs in this plan.

**Tech Stack:** Markdown, existing starter skill references, repository documentation, shell-based link/static checks.

## Global Constraints

- Scope is exactly `plugins/starter/skills/plugin-backend` and `plugins/starter/skills/plugin-frontend`, including their references.
- `mission-update` is a short tool id; plugin-owned skill ids remain qualified.
- Events invalidate; routes return snapshots; polling is prohibited.
- Browser plugins use the host-provided bridge over the single application SSE; they do not create `EventSource`.
- Every example must use exports and signatures that exist in `@sovereign/sdk` and `@sovereign/browser-sdk`.

---

### Task 1: Update backend plugin authoring guidance

**Files:**

- Modify: `plugins/starter/skills/plugin-backend/SKILL.md`
- Modify: `plugins/starter/skills/plugin-backend/references/sdk-reference.md`
- Test: `docs/superpowers/specs/2026-08-16-starter-sdk-skills-update-design.md` (manual checklist; no source test)

- [ ] **Step 1: Capture the current examples and identify stale or missing event/route/storage claims with `rg`.
- [ ] **Step 2: Rewrite the canonical backend example** to show `defineEvent("changed", schema)`, `contribute.event`, storage snapshot write, `contribute.route` read, and publication after successful write.
- [ ] **Step 3: Add explicit anti-polling rules**: no timer endpoint, no periodic reads, no event payload as source of truth, and no publication before storage success.
- [ ] **Step 4: Add session-scoped tool guidance** using `PluginToolInvocation.sessionId` rather than model-supplied ids.
- [ ] **Step 5: Update the SDK reference imports/signatures** to match current `@sovereign/sdk`, including `events`, `storage`, `defineEvent`, and `contribute.route`.
- [ ] **Step 6: Run** `git diff --check` and a link/reference audit; expect no broken local links or old API names.
- [ ] **Step 7: Commit** `docs(starter): document event-driven backend plugin patterns`.

### Task 2: Update frontend plugin authoring guidance

**Files:**

- Modify: `plugins/starter/skills/plugin-frontend/SKILL.md`
- Modify: `plugins/starter/skills/plugin-frontend/references/browser-reference.md`

- [ ] **Step 1: Add a failing text audit** that asserts the skill/reference contain `useSovereignEvents`, `PlaceContext.subject.sessionId`, `revision`, and no `EventSource` construction/polling example.
- [ ] **Step 2: Run** the audit; expect failure because the public bridge is not documented yet.
- [ ] **Step 3: Add the canonical component pattern**: subscribe through bridge, filter by session, fetch route, ignore stale revision, refetch on reconnect/gap.
- [ ] **Step 4: Explain that the host owns one SSE connection** and the plugin component must not open another or use polling.
- [ ] **Step 5: Update browser reference exports and context examples** without exposing internal host subpaths.
- [ ] **Step 6: Run** the audit, `git diff --check`, and existing starter skill quality checks; expect PASS.
- [ ] **Step 7: Commit** `docs(starter): document event-driven browser plugin patterns`.

### Task 3: Run the complete starter-skill documentation verification

**Files:**

- Test: `plugins/starter/skills/plugin-backend/SKILL.md`
- Test: `plugins/starter/skills/plugin-frontend/SKILL.md`
- Test: both `references/` trees
- Modify: `docs/README.md` only when the plan/spec index link is demonstrably stale after the skill edits

- [ ] **Step 1: Run a repository-local audit** for stale tools (`EventSource` construction, polling timers, `defineEvent` mismatches, unknown browser exports) across both skills.
- [ ] **Step 2: Run** `git diff --check`, `pnpm exec prettier --check plugins/starter/skills`, and the starter quality tests.
- [ ] **Step 3: Fix only findings in the two plugin skills and references.
- [ ] **Step 4: Commit** `test(starter): verify plugin SDK skill guidance`.

## Final Verification

- [ ] Confirm no `creating-skills`, `creating-agents`, or `creating-prompt-templates` file changed.
- [ ] Confirm backend guidance mandates route + event and forbids polling.
- [ ] Confirm frontend guidance mandates the SDK bridge + snapshot reload and forbids a second SSE.
- [ ] Run `make check` after the runtime/plugin plans land.
