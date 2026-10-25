# skills-tui

A native Rust terminal UI to inspect and manage agent skills.

- Browse configured repositories or installed Skill Instances.
- Find skills across configured repositories and preview their definitions.
- Save Skill Selections in User Scope or Project Scope.
- Restore missing selections and manage Agent Visibility through links or portable copies.
- Apply repository updates without blocking the interface.

## Install and run

Install [Rust](https://rustup.rs/) and Git, then run:

```sh
git clone https://github.com/kenbanks-peng/skills-tui
cd skills-tui
cargo install --path . --locked
skills-tui
```

Run from the project directory to manage its Project Scope. For development,
use `cargo run` or `./bin/skills-tui`. No JavaScript runtime is required.

Use `skills-tui --sync` to synchronize without opening the interface.
Use `cargo test --locked` to run isolated tests.

## Configuration

The first run creates `~/.config/skills-tui/config.toml`. Configure repository
identifiers (`owner/repo`), Git URLs, or local `file:///` URLs.
Remote repositories use cached Git checkouts; local repositories are read directly.
The default cache expiry is 24 hours. Updates fetch the latest remote content.

```toml
repos = ["anthropics/skills", "file:///path/to/skills"]
cache_expiry_hours = 24

[agents]
enabled = ["claude-code", "codex", "pi"]

[agents.universal]
both = ["codex", "pi"]
local = []

[[custom-agents]]
name = "portable"
display = "Portable Agent"
local = ".portable/skills"
global = "~/.config/portable/skills"
mode = "copy" # Default: "symlink"
```

Skill Selections are stored in
`~/.local/state/skills-tui/skill-selections.toml`, separate from config.
Synchronization runs at startup, after changes, and every 30 seconds.
The shared `~/.agents/skills` and `<project>/.agents/skills` locations are managed:
unselected Skill Instances are removed after adoption. Do not store independent
skills there.

Copy mode creates self-contained Skill Instances. It preserves unrelated entries
and removes only copies with a matching ownership marker.
See [selection and synchronization](docs/skill-link-reconciliation.md).

## Keys

| Key | Action |
|---|---|
| Tab, Shift+Tab, Left, Right | Change panel |
| Up, Down | Move through a list |
| Enter, Space | Select, install, remove, or toggle |
| g | Change Install Scope |
| / | Focus the filter |
| Page Up, Page Down | Scroll the preview or update output |
| r | Synchronize; apply latest versions in Updates |
| Esc | Clear the filter, then quit |
| q, Ctrl+C | Quit outside the filter; Ctrl+C always quits |

Agents that discover shared locations directly retain Agent Visibility even
when their checkbox is cleared.

## License

MIT
