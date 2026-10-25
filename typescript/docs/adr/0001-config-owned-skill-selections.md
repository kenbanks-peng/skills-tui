# ADR-0001: Skills TUI config owns skill selections

Status: Storage location superseded by [ADR-0002](0002-separate-selection-state.md).

## Decision

Skills TUI stores selected repository/name pairs in its own config. User Scope and
each Project Scope have separate selection lists. Another tool's lock files are
not an interface for reading or writing this state.

On first use, adopt existing installed skills from successfully checked configured
repositories. Do not install every skill in those repositories. Report ambiguous
repository matches rather than choose a source without evidence.

Reconcile the shared Skill Locations against these selections in the background
after the interface mounts, after selection changes, and periodically while open.
Restore missing selected skills.
Remove deselected skills, skills from removed repositories, and skills confirmed
absent upstream. Repository failures must not cause deletion.

The skills CLI remains an adapter for remote discovery and explicit named
installation. Manual updates reinstall selected skills; routine startup and
periodic checks preserve intact selected folders. Do not delegate selection
decisions to the CLI's update command.

This corrects the initial startup policy, which blocked the interface while
reinstalling every selected skill. Network checks must not delay opening the
interface, and routine checks must not perform those redundant installations.

## Consequences

Deleting deployed folders does not delete selections; synchronization restores
selected content. Removing a skill through the TUI persists that choice. Shared
Skill Locations are managed locations, not storage for independent unselected
content. Agent Visibility is reconciled separately from skill selections.
