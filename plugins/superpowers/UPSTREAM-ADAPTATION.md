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

| Upstream assumption | Sovereign replacement |
| --- | --- |
| Runtime-specific skill lookup | Plugin-qualified file resources such as `superpowers.writing-plans` |
| Task-list or plan update API | Per-session `mission-update` snapshot plus durable Markdown plans |
| Runtime-specific shell aliases | `bash`, with `job-output` and `job-kill` for background jobs |
| Runtime-specific file tools | Core `read`, `write`, and `edit` tools |
| Task/general-purpose agents | Public `subagent-*` tools and discovered agent/model identifiers |
| Native worktree API | Ownership-aware `git worktree` commands through `bash` |

The final port audit records intentional removals and every bundled neighboring resource after the
skill trees are adapted.
