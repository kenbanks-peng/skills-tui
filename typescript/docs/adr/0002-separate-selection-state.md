# ADR-0002: Separate skill selection state from config

Status: Accepted

## Decision

Keep repository and agent settings in `~/.config/skills-tui/config.toml`.
Store Skill Selections in `~/.local/state/skills-tui/skill-selections.toml`.
User Scope and each Project Scope retain separate lists in this state file.

Synchronization and selection changes must not write to config. State writes
use atomic replacement and owner-only file permissions. A missing state scope
permits first-run adoption; an empty scope preserves an explicit empty selection.
Invalid state stops cleanup rather than starting adoption.

## Consequences

Machine-specific project paths and application-managed selections do not enter
dotfiles through config. ADR-0001's adoption and reconciliation rules still apply.
Existing selection data must be moved to state before synchronization if saved
choices must be preserved; the application does not rewrite existing config.
