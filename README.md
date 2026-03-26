# skills-tui

A terminal UI for managing AI agent skills.

Browse skill repositories, install/remove skills, check for updates, and control which agents receive which skills, all from one place.

![Built with OpenTUI](https://img.shields.io/badge/built%20with-OpenTUI-blue)

## Features

- **Browse by repo** — explore skills from configured repositories (GitHub, remote URL, or local `file://` path)
- **Browse by skill** — see all installed skills and which agents they're linked to
- **Find** — search for skills across repos
- **Check & Update** — check for and apply skill updates
- **Multi-agent support** — install skills to any combination of agents at once
- **Global & local** — toggle between global (`~/.agents/skills/`) and project-local (`.agents/skills/`) installs
- **Filter** — type-ahead filtering when browsing skills


## Install & Run

```sh
# Clone the repo
git clone https://github.com/kenbanks-peng/skills-tui
cd skills-tui

# Install dependencies
bun install

# Run
bun src/index.tsx
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

## Keyboard Controls

| Key | Action |
|---|---|
| `←`/`→` or `Tab` | Switch panels |
| `↑`/`↓` | Navigate lists |
| `Enter` | Select / Install |
| `Space` | Toggle selection |
| `g` | Toggle global/local |
| `Esc` | Exit |

## License

MIT
