use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    env, fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug)]
pub struct Locations {
    pub home: PathBuf,
    pub project: PathBuf,
    pub config: PathBuf,
    pub state: PathBuf,
    pub cache: PathBuf,
}
impl Locations {
    pub fn detect() -> Result<Self> {
        let home = PathBuf::from(env::var_os("HOME").context("HOME is not set")?);
        Ok(Self::new(home, env::current_dir()?.canonicalize()?))
    }
    pub fn new(home: PathBuf, project: PathBuf) -> Self {
        Self {
            config: home.join(".config/skills-tui/config.toml"),
            state: home.join(".local/state/skills-tui"),
            cache: home.join(".cache/skills-tui"),
            home,
            project,
        }
    }
    pub fn shared(&self, scope: Scope) -> PathBuf {
        match scope {
            Scope::User => &self.home,
            Scope::Project => &self.project,
        }
        .join(".agents/skills")
    }
    pub fn agent_dir(&self, agent: &Agent, scope: Scope) -> PathBuf {
        let value = match scope {
            Scope::User => &agent.global,
            Scope::Project => &agent.local,
        };
        if let Some(rest) = value.strip_prefix("~/") {
            return self.home.join(rest);
        }
        let base = match scope {
            Scope::User => &self.home,
            Scope::Project => &self.project,
        };
        base.join(value)
    }
    pub fn initialize(&self) -> Result<()> {
        fs::create_dir_all(self.config.parent().unwrap())?;
        fs::create_dir_all(&self.state)?;
        fs::create_dir_all(&self.cache)?;
        // create_new prevents two first launches from overwriting configuration.
        use std::io::Write;
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&self.config)
        {
            Ok(mut file) => file.write_all(include_bytes!("default-config.toml"))?,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(e.into()),
        }
        Ok(())
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scope {
    User,
    Project,
}
impl Scope {
    pub fn label(self) -> &'static str {
        match self {
            Self::User => "User Scope",
            Self::Project => "Project Scope",
        }
    }
    pub fn toggle(self) -> Self {
        match self {
            Self::User => Self::Project,
            Self::Project => Self::User,
        }
    }
}
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    #[default]
    Symlink,
    Copy,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Agent {
    pub name: String,
    pub display: String,
    pub local: String,
    pub global: String,
    #[serde(default)]
    pub mode: Mode,
}
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum CustomAgent {
    Name(String),
    Override {
        name: String,
        display: Option<String>,
        local: Option<String>,
        global: Option<String>,
        mode: Option<Mode>,
    },
}
#[derive(Clone, Debug, Default, Deserialize)]
pub struct Universal {
    #[serde(default)]
    pub both: BTreeSet<String>,
    #[serde(default)]
    pub local: BTreeSet<String>,
}
#[derive(Debug, Default, Deserialize)]
struct AgentSettings {
    #[serde(default)]
    enabled: Vec<String>,
    #[serde(default)]
    universal: Universal,
}
#[derive(Debug, Deserialize)]
struct RawConfig {
    repos: Vec<String>,
    #[serde(default)]
    agents: AgentSettings,
    #[serde(default, rename = "custom-agents")]
    custom: Vec<CustomAgent>,
    #[serde(default = "default_expiry")]
    cache_expiry_hours: f64,
}
fn default_expiry() -> f64 {
    24.0
}
#[derive(Clone, Debug)]
pub struct Config {
    pub repos: Vec<String>,
    pub agents: Vec<Agent>,
    pub universal: Universal,
    pub cache_expiry_hours: f64,
}
impl Config {
    pub fn load(path: &Path) -> Result<Self> {
        let raw: RawConfig =
            toml::from_str(&fs::read_to_string(path)?).context("Invalid configuration")?;
        ensure!(
            raw.cache_expiry_hours.is_finite() && raw.cache_expiry_hours > 0.0,
            "Cache expiry must be positive"
        );
        let registry: Vec<Agent> = serde_json::from_str(include_str!("agents.json"))?;
        let resolve = |name: &str| {
            registry
                .iter()
                .find(|a| a.name == name)
                .cloned()
                .unwrap_or_else(|| Agent {
                    name: name.into(),
                    display: name.into(),
                    local: ".agents/skills/".into(),
                    global: "~/.config/agents/skills/".into(),
                    mode: Mode::Symlink,
                })
        };
        let mut agents = Vec::<Agent>::new();
        for name in raw.agents.enabled {
            if !agents.iter().any(|a| a.name == name) {
                agents.push(resolve(&name));
            }
        }
        for custom in raw.custom {
            let agent = match custom {
                CustomAgent::Name(name) => resolve(&name),
                CustomAgent::Override {
                    name,
                    display,
                    local,
                    global,
                    mode,
                } => {
                    let mut a = resolve(&name);
                    if let Some(v) = display {
                        a.display = v;
                    }
                    if let Some(v) = local {
                        a.local = v;
                    }
                    if let Some(v) = global {
                        a.global = v;
                    }
                    if let Some(v) = mode {
                        a.mode = v;
                    }
                    a
                }
            };
            ensure!(
                !agent.name.is_empty() && !agent.local.is_empty() && !agent.global.is_empty(),
                "Agent paths and names must not be empty"
            );
            if let Some(index) = agents.iter().position(|a| a.name == agent.name) {
                agents[index] = agent;
            } else {
                agents.push(agent);
            }
        }
        let mut repos = Vec::new();
        for repo in raw.repos {
            ensure!(!repo.trim().is_empty(), "Repository must not be empty");
            if !repos.contains(&repo) {
                repos.push(repo);
            }
        }
        Ok(Self {
            repos,
            agents,
            universal: raw.agents.universal,
            cache_expiry_hours: raw.cache_expiry_hours,
        })
    }
    pub fn universal(&self, name: &str, scope: Scope) -> bool {
        self.universal.both.contains(name)
            || (scope == Scope::Project && self.universal.local.contains(name))
    }
}
