# Startup skill update and link reconciliation

Before it opens the interface, Skills TUI updates all lock-tracked skills in User Scope and Project Scope to their latest upstream revisions. No confirmation is required. A failure in one scope does not prevent an update in the other scope or prevent the interface from opening. The pinned `skills` CLI version controls update behavior; skill revisions are not pinned.

After the updates, Skills TUI reconciles deployed skills and skill links once. It does not run this cleanup on a timer, on scope changes, or after install/remove/update actions.

First, Skills TUI computes the enabled User Scope skills from the configured repositories and the skills CLI user lock. It removes every other immediate folder from `~/.agents/skills/`. A missing or malformed lock enables no lock-tracked skills. Skills in configured `file://` repositories remain enabled. Regular files and symlinks are not skill folders and remain unchanged. This check does not change the lock file.

Then, the link check covers both User Scope and Project Scope for all agents loaded from `config.toml`, including custom agents and agents unchecked in Settings. Project Scope means the current working directory.

Only immediate symlink entries in configured agent Skill Locations are checked. A link can be removed only when its target is missing and its resolved target path is inside the matching shared directory:

- User Scope: `~/.agents/skills/`
- Project Scope: `<project>/.agents/skills/`

Relative link targets are resolved from the physical parent directory, after following directory symlinks. This supports agent folders linked into a dotfiles repository. Existing path aliases are resolved before the scope check. The link check leaves live links, unrelated targets, regular files, directories, and nested skill content unchanged. It does not change lock files or reinstall skills.

The link and target are checked again before removal. Missing locations are skipped. Other filesystem errors are reported at startup; they do not count as proof that a target is missing. Cleanup continues at other entries and locations.

A skill removed manually while the TUI is open leaves its dead links until the next startup.

## Agent selection synchronization

Changing an agent checkbox in Settings synchronizes that agent's links immediately
in User Scope and the current Project Scope, regardless of the displayed scope.
Scopes supported by the agent in `[agents.universal]` are skipped before any
filesystem access: `both` skips both scopes; `local` skips Project Scope only.
These agents already discover skills from the shared location, even if their
registry entry also lists an agent-specific Skill Location.
For other scopes, enabling backfills links for existing shared Skill Instances
containing a `SKILL.md`. Disabling removes that agent's immediate links to those shared
instances, including dead links. Shared skill content and lock files are unchanged.
This is separate from startup cleanup and does not download or reinstall skills.

Independent agent copies and unrelated links remain unchanged. An existing
conflicting entry is reported in the interface rather than overwritten.
Synchronization continues for other entries and scopes after an error; the
selection is still saved. Toggling off and on retries backfilling after resolving
a conflict. The Installed view reloads after synchronization.

A location still used by another selected agent is preserved. The shared
`.agents/skills` location itself is never removed. Agents configured to read
shared locations directly (such as OpenCode and Pi) can therefore retain Agent
Visibility even when unchecked. Selection is not an access-control boundary.

Run the isolated filesystem tests with `pnpm test`. Tests use temporary folders, not live Skill Locations.
