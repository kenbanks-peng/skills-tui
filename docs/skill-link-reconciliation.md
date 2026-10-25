# Skill selection and synchronization

Skills TUI config is the source of truth for selected skills. Skills TUI does not
read or change another tool's lock files. The skills CLI is used to list remote
repository skills and install explicitly named skills, not to determine selections.

## Existing selections

On the first successful synchronization of each scope, existing installed skills
that still exist in a configured repository become the initial selections.
Unselected repository skills are not installed. All configured repositories must
be checked successfully before first-run adoption can remove any content.

If an installed name exists in multiple configured repositories, adoption stops
for that scope and reports the conflict. Set the repository explicitly in the
selection config below, including all skills you want to keep. Skills TUI does
not guess which repository supplied that Skill Instance.

## Configuration

Selections are saved in `~/.config/skills-tui/config.toml`. User Scope and each
Project Scope have separate lists. A missing list means adoption has not completed;
an empty list means no skills are selected.

```toml
repos = ["owner/repo"]

[skills]
user = [{ repo = "owner/repo", name = "example" }]

[skills.projects]
"/absolute/path/to/project" = [{ repo = "owner/repo", name = "example" }]
```

The TUI saves install/remove selections immediately. Other config sections and
their comments remain unchanged. Project Scope means the current working directory;
other projects are not modified.

## Reconciliation

Synchronization starts in the background after the interface mounts, runs after
skill selections change, and repeats every 30 seconds while the interface is open.
The interface does not wait for repository checks. A status line shows when a
check is running. The Check/Update action also synchronizes the displayed scope.

For each scope, Skills TUI:
- Keeps selected skills that still exist in their configured repository.
- Restores selected Skill Instances whose shared folders are missing.
- Removes selections and shared folders when their repository is no longer
  configured or a successful repository check confirms the skill is absent.
- Removes unselected immediate folders and symlinks from the shared Skill Location.
  Regular files and nested content of retained skills remain unchanged.
- Synchronizes agent links and managed standalone copies.

The shared Skill Locations are `~/.agents/skills/` in User Scope and
`<project>/.agents/skills/` in Project Scope. Do not use them to store independent,
unselected skills: they are managed by Skills TUI.

Startup and the 30-second checks repair missing content and detect removed skills.
They do not reinstall intact selected folders. Use Check/Update to refresh selected
content from upstream. Failed installations remain selected and are retried on the
next check. Edit repository content rather than deployed copies, because an update
replaces deployed content.

A failed or incomplete repository check preserves that repository's selections
and content. It is not proof of deletion. Malformed selection config prevents
cleanup. Errors are reported; other repositories and entries can still synchronize.
Configuration changes during repository checks cause the pass to stop and retry
on the next check rather than apply an old selection snapshot.

## Agent Visibility

Agent checkboxes control links or copies, not shared skill selections. Changing
a checkbox applies to both scopes. Enabling an agent creates links to existing
shared Skill Instances; disabling removes its links, including dead links.

Independent agent entries and unrelated links remain unchanged. Conflicts are
reported rather than overwritten. The interface shows one warning and a count of
additional errors, without stack traces. Check/Update shows the full error list.
Locations shared with another selected agent are preserved.

An old relative link can become broken when an agent directory is linked into a
dotfiles repository. If its relative text names exactly the matching shared
Skill Instance from the configured agent location, and its actual target is
confirmed missing, synchronization replaces it with an absolute link. Disabling
the agent removes that stale link instead. Live links to other locations and
unrelated dead links are not changed. The entry, directory aliases, and missing
target are checked again before repair or removal.

Agents configured to discover the shared location directly need no links.
Unchecking them cannot prevent Agent Visibility. Copy mode instead deploys
self-contained managed copies, even for agents with shared discovery.

Dead-link cleanup checks immediate symlinks for all configured agents in both
scopes. Only missing targets inside the matching shared Skill Location qualify.
Relative targets are resolved from the physical parent directory, including
dotfiles directory aliases. Filesystem errors are not proof of missing targets.
Links and targets are checked again before removal.

Run `pnpm test` for isolated tests. Tests use temporary folders, not live Skill
Locations.
