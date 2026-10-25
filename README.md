# skills-tui

A terminal UI for managing AI agent skills.

Browse skill repositories, install/remove skills, check for updates, and control which agents receive which skills, all from one place.

![Built with OpenTUI](https://img.shields.io/badge/built%20with-OpenTUI-blue)

## Features

- **Browse by repo** — explore skills from configured repositories (GitHub, remote URL, or local `file://` path)
- **Browse by skill** — see all installed skills and which agents they're linked to
- **Find** — search for skills across repos
- **Automatic synchronization** — restore missing selected skills and remove obsolete skills in the background, without blocking startup
- **Multi-agent support** — install skills to any combination of agents at once
- **Global & local** — toggle between global (`~/.agents/skills/`) and project-local (`.agents/skills/`) installs
- **Filter** — type-ahead filtering when browsing skills


## Install & Run

```sh
# Clone the repo
git clone https://github.com/kenbanks-peng/skills-tui
cd skills-tui

# Install dependencies
pnpm install

# Run
./bin/skills-tui
```

## Configuration

On first run, a default config is created at `~/.config/skills-tui/config.toml`. It defines:

- **`repos`** — skill repositories to browse (GitHub `owner/repo`, `https://` URLs, or `file:///` paths)
- **`[agents] enabled`** — which agents to manage
- **`[[custom-agents]]`** — add your own agents with custom skill paths

Example custom agent:

```toml
[[custom-agents]]
name = "my-agent"
display = "My Agent"
local = ".my-agent/skills/"
global = "~/.my-agent/skills/"
```

Skill selections are saved in `~/.local/state/skills-tui/skill-selections.toml`,
not in config. Existing installed selections are
adopted on the first successful synchronization. Missing selected folders are
restored; deselected and confirmed obsolete skills are removed. Synchronization
runs at startup, after selections change, and every 30 seconds while open.
See [selection and synchronization](docs/skill-link-reconciliation.md).

### Standalone copies for mounted configurations

Custom entries default to symlinks into the shared `~/.agents/skills/`
(User Scope) or `.agents/skills/` (Project Scope). Set `mode = "copy"`
when the destination must work without access to those paths:

```toml
[[custom-agents]]
name = "pi-linux"
display = "Pi Linux"
local = ".pi-linux/skills/"
global = "~/.config/linux/pi/agent/skills/"
mode = "copy"
```

The Settings checkbox deploys self-contained copies, including dereferenced
content symlinks. Copies refresh at startup, after installs/removals, and after
updates. Disabling removes only copies managed by Skills TUI; independent
entries are preserved and reported as conflicts. Managed copies contain a
`.skills-tui-copy.json` ownership marker and are replaced on refresh, so edit
the source Skill Instance, not the deployed copy. Copy mode takes precedence
over universal discovery settings. Only paths inside the mounted destination
are needed by the receiving runtime.

## Keyboard Controls

| Key | Action |
|---|---|
| `Tab` `←` `↑` `→` `↓` | Navigate |
| `Enter` | Select / Install |
| `Space` | Toggle selection |
| `g` | Toggle global/local |
| `Esc` | Quit |

## License

MIT
