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

Run the isolated filesystem tests with `bun test`. Tests use temporary folders, not live Skill Locations.
