# Superpowers Built-in Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port all 14 Superpowers 6.2.0 skills and required neighboring resources into an English-language Sovereign built-in skills-only plugin.

**Architecture:** Copy the upstream skill graph into `plugins/superpowers/skills`, then adapt only platform assumptions: Mission replaces Codex task tracking, `bash` replaces shell aliases, Sovereign `subagent-*` tools replace Task/general-purpose dispatch, and Git worktrees use shell commands. The plugin has a minimal activating worker and no own tool/UI/route/storage contributions.

**Tech Stack:** Markdown/YAML frontmatter, shell scripts, existing Sovereign file-resource loader, Node `node:test`, artifact payload builder, git.

## Global Constraints

- Exactly 14 source `SKILL.md` files are ported with stable English names and text.
- Relative references/scripts/assets remain inside `plugins/superpowers`; no symlinks.
- Upstream version is 6.2.0; preserve MIT license and Jesse Vincent attribution.
- Replace Codex/Claude/Pi/Gemini/Antigravity runtime assumptions with Sovereign tools and `sovereign-tools.md`.
- Mission tracking uses short tool id `mission-update`; durable plans remain Markdown files in `docs/superpowers`.
- No new Superpowers worker tools, routes, storage, browser code, or UI contributions.
- Every ported frontmatter entry must satisfy Sovereign file-resource validation and plugin-qualified discovery.

---

### Task 1: Scaffold the built-in plugin and establish source inventory

**Files:**
- Create: `plugins/superpowers/package.json`
- Create: `plugins/superpowers/tsconfig.json`
- Create: `plugins/superpowers/src/worker.ts`
- Create: `plugins/superpowers/LICENSE`
- Create: `plugins/superpowers/UPSTREAM-ADAPTATION.md`
- Test: `apps/daemon/src/plugins/superpowers-skills.test.ts`

- [ ] **Step 1: Write failing inventory test** asserting plugin manifest id `superpowers`, worker path, and exactly 14 source skill directories.
- [ ] **Step 2: Run** `pnpm --filter @sovereign/daemon exec node --test src/plugins/superpowers-skills.test.ts`; expect failure because the plugin is absent.
- [ ] **Step 3: Scaffold** a minimal ESM worker exporting `activate`/`deactivate`, with no contributions, and package manifest compatible with `plugins/starter`.
- [ ] **Step 4: Add** MIT license, upstream version/attribution, and adaptation document skeleton listing every source skill and its Sovereign replacement.
- [ ] **Step 5: Run** the inventory test and plugin discovery type checks; expect PASS.
- [ ] **Step 6: Commit** `feat(superpowers): scaffold built-in skills plugin`.

### Task 2: Port the core planning and quality skills

**Files:**
- Create: `plugins/superpowers/skills/brainstorming/**`
- Create: `plugins/superpowers/skills/using-superpowers/**`
- Create: `plugins/superpowers/skills/writing-plans/**`
- Create: `plugins/superpowers/skills/test-driven-development/**`
- Create: `plugins/superpowers/skills/systematic-debugging/**`
- Create: `plugins/superpowers/skills/verification-before-completion/**`

- [ ] **Step 1: Copy** only the six source skill trees and run a resource/link inventory that records every relative target.
- [ ] **Step 2: Adapt** `using-superpowers` to Sovereign discovery/read semantics and `mission-update`.
- [ ] **Step 3: Adapt** brainstorming visual companion scripts to run via Sovereign `bash`, retaining approval gate and English text.
- [ ] **Step 4: Adapt** plans/TDD/debugging/verification commands to project `CLAUDE.md`, `AGENTS.md`, `read`, `write`, `edit`, and `bash`.
- [ ] **Step 5: Replace platform-specific references with links to `../using-superpowers/references/sovereign-tools.md` where needed.
- [ ] **Step 6: Run** frontmatter parser/resource audit; expect all six skills valid and every relative link resolvable.
- [ ] **Step 7: Commit** `feat(superpowers): port planning and quality skills`.

### Task 3: Port collaboration, branch, and skill-authoring skills

**Files:**
- Create: `plugins/superpowers/skills/dispatching-parallel-agents/**`
- Create: `plugins/superpowers/skills/subagent-driven-development/**`
- Create: `plugins/superpowers/skills/requesting-code-review/**`
- Create: `plugins/superpowers/skills/receiving-code-review/**`
- Create: `plugins/superpowers/skills/executing-plans/**`
- Create: `plugins/superpowers/skills/finishing-a-development-branch/**`
- Create: `plugins/superpowers/skills/using-git-worktrees/**`
- Create: `plugins/superpowers/skills/writing-skills/**`

- [ ] **Step 1: Copy** the eight source trees including prompt templates and bundled scripts.
- [ ] **Step 2: Replace** subagent dispatch templates with `subagent-spawn`, `subagent-types`, `subagent-models`, `subagent-list`, `subagent-output`, `subagent-message`, and `subagent-stop`.
- [ ] **Step 3: Replace** task-list operations with `mission-update` plus Markdown ledger/checklists; document that Mission is per-session and plans are durable files.
- [ ] **Step 4: Adapt** worktree detection/creation/cleanup to `bash` + `git worktree`, preserving ownership safeguards and no native API assumption.
- [ ] **Step 5: Port `writing-skills` pressure-scenario guidance without inventing a task-list API; use Mission/ledger fallback described above.
- [ ] **Step 6: Add** `plugins/superpowers/skills/using-superpowers/references/sovereign-tools.md` and remove Codex/Pi/Gemini/Antigravity tool-reference files from the shipped tree.
- [ ] **Step 7: Run** static forbidden-token and link audits; expect no unsupported tool names in executable workflow sections.
- [ ] **Step 8: Commit** `feat(superpowers): port collaboration and authoring skills`.

### Task 4: Validate all 14 file resources and plugin-qualified discovery

**Files:**
- Modify: `apps/daemon/src/plugins/superpowers-skills.test.ts`
- Test: `apps/daemon/src/plugins/file-resources.integration.test.ts` (modify only when the focused discovery assertions require the shared integration harness)
- Modify: `plugins/superpowers/UPSTREAM-ADAPTATION.md`

- [ ] **Step 1: Add failing assertions** for exactly 14 valid `superpowers.<name>` skills, no invalid entries, no unsupported symlinks, and expected neighboring resources.
- [ ] **Step 2: Run** the focused daemon file-resource tests; expect failure for any invalid frontmatter/link/resource.
- [ ] **Step 3: Fix** frontmatter, names, descriptions, relative paths, and adaptation notes until discovery is clean.
- [ ] **Step 4: Add forbidden-token audit** that distinguishes historical mentions in the adaptation map from live instructions that tell the model to call unsupported tools.
- [ ] **Step 5: Run** focused tests and `pnpm --filter @sovereign/daemon run typecheck`; expect PASS.
- [ ] **Step 6: Commit** `test(superpowers): validate built-in skill discovery`.

### Task 5: Include Superpowers in artifact payload

**Files:**
- Modify: `apps/daemon/scripts/builtin-plugins-payload.test.ts`
- Modify: `docs/toolchain.md`
- Modify: `docs/roadmap.md`

- [ ] **Step 1: Add fixture assertions** that a skills-only plugin ships its worker, manifest, all skill resources, LICENSE, and adaptation document while excluding tests/configs.
- [ ] **Step 2: Run** the focused payload test; expect failure until the fixture/build behavior covers the new plugin.
- [ ] **Step 3: Implement only required payload changes**; do not add a second built-in root or special skill loader.
- [ ] **Step 4: Update** production artifact documentation from `starter`/`subagents` to include `mission` and `superpowers`.
- [ ] **Step 5: Run** payload tests and `make build`; expect PASS.
- [ ] **Step 6: Commit** `build(superpowers): include skills plugin in artifact payload`.

### Task 6: Perform final port audit and documentation handoff

**Files:**
- Modify: `docs/README.md`
- Modify: `docs/file-resources.md`
- Modify: `docs/plugins.md`
- Modify: `plugins/superpowers/UPSTREAM-ADAPTATION.md`

- [ ] **Step 1: Run** `rg` audits for all 14 skill IDs, old platform tool names, broken relative links, and accidental Russian translation of skill bodies.
- [ ] **Step 2: Run** `git diff --check`, Prettier checks, daemon resource tests, `make check`, and `make build`.
- [ ] **Step 3: Record** exact intentional removals and fallbacks in `UPSTREAM-ADAPTATION.md`, including no native worktree API and no task-list API.
- [ ] **Step 4: Update** docs indexes and the relevant “Почему так” sections with the final built-in plugin list and discovery IDs.
- [ ] **Step 5: Commit** `docs(superpowers): record Sovereign port and adaptation map`.

## Final Verification

- [ ] Confirm `find plugins/superpowers/skills -name SKILL.md | wc -l` returns `14`.
- [ ] Confirm no live skill instruction invokes unsupported Codex/Claude/Pi/Gemini/Antigravity tools.
- [ ] Confirm `mission-update` appears wherever upstream task-list behavior is required.
- [ ] Run `make check` and `make build`.
- [ ] Confirm artifact discovery exposes `builtin:superpowers.<skill>` and includes `mission`/`superpowers` payloads.
