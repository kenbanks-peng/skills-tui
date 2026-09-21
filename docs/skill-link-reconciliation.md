# Startup skill link reconciliation

Skills TUI checks skill links once at startup, before it opens the interface. No confirmation is required. It does not run this check on a timer, on scope changes, or after install/remove/update actions.

The check covers both User Scope and Project Scope for all agents loaded from `config.toml`, including custom agents and agents unchecked in Settings. Project Scope means the current working directory.

Only immediate symlink entries in configured agent Skill Locations are checked. A link can be removed only when its target is missing and its resolved target path is inside the matching shared directory:

- User Scope: `~/.agents/skills/`
- Project Scope: `<project>/.agents/skills/`

Relative link targets are resolved from the link's parent directory. The check leaves live links, unrelated targets, regular files, directories, and nested skill content unchanged. It does not change lock files or reinstall skills.

The link and target are checked again before removal. Missing locations are skipped. Other filesystem errors are reported at startup; they do not count as proof that a target is missing. Cleanup continues at other entries and locations.

A skill removed manually while the TUI is open leaves its dead links until the next startup.

Run the isolated filesystem tests with `bun test`. Tests use temporary folders, not live Skill Locations.
