# Superpowers 6.2.0 adaptation for Sovereign

This built-in plugin ports the complete Superpowers 6.2.0 skill set by Jesse Vincent under the MIT
license. Skill prose remains in English. Platform-specific instructions are adapted to the public
Sovereign runtime instead of emulating unavailable private APIs.

## Source inventory

- `brainstorming`
- `dispatching-parallel-agents`
- `executing-plans`
- `finishing-a-development-branch`
- `receiving-code-review`
- `requesting-code-review`
- `subagent-driven-development`
- `systematic-debugging`
- `test-driven-development`
- `using-git-worktrees`
- `using-superpowers`
- `verification-before-completion`
- `writing-plans`
- `writing-skills`

## Adaptation map

| Upstream assumption            | Sovereign replacement                                               |
| ------------------------------ | ------------------------------------------------------------------- |
| Runtime-specific skill lookup  | Plugin-qualified file resources such as `superpowers.writing-plans` |
| Task-list or plan update API   | Per-session `mission-update` snapshot plus durable Markdown plans   |
| Runtime-specific shell aliases | `bash`, with `job-output` and `job-kill` for background jobs        |
| Runtime-specific file tools    | Core `read`, `write`, and `edit` tools                              |
| Task/general-purpose agents    | Public `subagent-*` tools and discovered agent/model identifiers    |
| Native worktree API            | Ownership-aware `git worktree` commands through `bash`              |

## Bundled neighboring resources

The port keeps each upstream neighbor used by the 14 skills, including the brainstorming visual
companion, review prompt templates, Subagent-Driven Development helper scripts, systematic debugging
references and pressure scenarios, TDD test guidance, and writing-skills references/examples. The
resources are copied as regular files; the built-in payload contains no symlinks.

## Intentional removals and fallbacks

- `codex-tools.md`, `pi-tools.md`, `gemini-tools.md`, and `antigravity-tools.md` are replaced by the
  single `skills/using-superpowers/references/sovereign-tools.md` reference.
- Runtime-specific Task/general-purpose dispatch is replaced by discovered agent/model IDs and
  `subagent-spawn`, `subagent-list`, `subagent-output`, `subagent-message`, and `subagent-stop`.
- Runtime-specific todo or plan APIs are not emulated. `mission-update` holds the current per-session
  snapshot; Markdown plans and ledgers remain durable repository state.
- No native worktree API is promised. Worktree workflows use ownership-aware `git worktree` commands
  through `bash` and never remove a worktree merely because its path looks conventional.
- The visual companion remains optional and bundled. Its scripts run through `bash`; foreground jobs
  use `run_in_background: true`, `job-output`, and `job-kill` when detached processes cannot survive.

The plugin adds no tools, routes, storage, browser code, or UI contributions of its own.
