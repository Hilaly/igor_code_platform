# Sovereign tool mapping

Superpowers skills name actions. Translate them to the public Sovereign tools below. Never invent a
tool because another runtime exposes a similarly named capability.

| Action                                   | Sovereign tool                        |
| ---------------------------------------- | ------------------------------------- |
| Read, create, or edit a file             | `read`, `write`, or `edit`            |
| Search files or text                     | `bash` with `rg --files` or `rg`      |
| Run a shell command                      | `bash`                                |
| Start a long command                     | `bash` with `run_in_background: true` |
| Inspect or stop a background command     | `job-output` or `job-kill`            |
| Track the current session goal and steps | `mission-update`                      |
| Discover agent types or models           | `subagent-types` or `subagent-models` |
| Dispatch independent work                | `subagent-spawn`                      |
| Inspect active or completed subagents    | `subagent-list` or `subagent-output`  |
| Coordinate or stop a subagent            | `subagent-message` or `subagent-stop` |

## Mission and durable plans

Mission is per session. Call `mission-update` with a concrete mission description and the complete
current step list. Update statuses as work progresses; at most one step is `in_progress`. Mission is
the live model/UI snapshot, not project history. Keep implementation plans and any durable execution
ledger in repository Markdown, normally below `docs/superpowers/` unless project instructions say
otherwise.

## Skills and instructions

Sovereign discovers plugin-owned skills under qualified IDs such as
`superpowers.systematic-debugging`. The skill content is already available through its discovered
resource; do not search a user home directory for it. Read `AGENTS.md`, `CLAUDE.md`, and relevant
repository documentation before changing a project.

## Worktrees

Sovereign has no native worktree API. Use `bash` with explicit `git worktree` commands. Verify the
repository and resolved target before creation or removal, and remove only a worktree created by the
current workflow.
