//! Serialized selection, synchronization, and deployment behind one interface.
use crate::{
    config::{Config, Locations, Scope},
    deployment, files,
    repository::{self, Inventory},
    state::{self, Selection, Selections},
};
use anyhow::{Result, ensure};
use fs2::FileExt;
use std::{collections::BTreeSet, fs};

#[derive(Clone, Debug)]
pub enum Action {
    Synchronize,
    Update(Scope),
    Toggle {
        repo: String,
        name: String,
        scope: Scope,
    },
    ToggleAgent(String),
}
#[derive(Clone, Debug)]
pub struct Snapshot {
    pub config: Config,
    pub selections: Selections,
    pub disabled: BTreeSet<String>,
    pub inventory: Inventory,
    pub errors: Vec<String>,
    pub changed: usize,
}
pub struct Manager {
    pub locations: Locations,
    // The lock is held for the lifetime of the process, including its worker.
    _lock: fs::File,
}
impl Manager {
    pub fn open(locations: Locations) -> Result<Self> {
        locations.initialize()?;
        let lock = fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(locations.state.join("manager.lock"))?;
        lock.try_lock_exclusive()
            .map_err(|_| anyhow::anyhow!("Another Skills TUI process is running"))?;
        Ok(Self {
            locations,
            _lock: lock,
        })
    }
    pub fn run(&mut self, action: Action) -> Result<Snapshot> {
        let original = fs::read(&self.locations.config)?;
        let config = Config::load(&self.locations.config)?;
        // Validate all saved intent before making any filesystem change.
        let mut selections = Selections::load(&self.locations)?;
        let mut disabled = state::load_disabled(&self.locations)?;
        let force = matches!(action, Action::Update(_));
        let inventory = repository::inventory(
            &self.locations,
            &config.repos,
            config.cache_expiry_hours,
            force,
        );
        ensure!(
            fs::read(&self.locations.config)? == original,
            "Configuration changed during repository checks; retry"
        );
        let mut errors = inventory.errors.clone();
        for scope in [Scope::User, Scope::Project] {
            if selections.get(scope, &self.locations.project).is_some() {
                continue;
            }
            if inventory.repos.len() != config.repos.len() {
                continue;
            }
            let mut adopted = Vec::new();
            let mut ambiguous = false;
            for path in files::entries(&self.locations.shared(scope))? {
                if !path.join("SKILL.md").is_file() {
                    continue;
                }
                let name = files::name(&path)?;
                let repos = inventory
                    .repos
                    .iter()
                    .filter(|(_, skills)| skills.iter().any(|s| s.name == name))
                    .map(|(r, _)| r)
                    .collect::<Vec<_>>();
                if repos.len() > 1 {
                    ambiguous = true;
                    errors.push(format!(
                        "{}: choose a repository in Skill Selection state before adoption",
                        path.display()
                    ));
                } else if let Some(repo) = repos.first() {
                    adopted.push(Selection {
                        repo: (*repo).clone(),
                        name,
                    });
                }
            }
            if !ambiguous {
                selections.set(scope, &self.locations.project, adopted)?;
            }
        }
        if let Action::Toggle { repo, name, scope } = &action {
            ensure!(files::safe_name(name), "Invalid Skill name");
            let mut selected = selections
                .get(*scope, &self.locations.project)
                .cloned()
                .ok_or_else(|| {
                    anyhow::anyhow!("Cannot adopt selections until all repositories are available")
                })?;
            if let Some(index) = selected
                .iter()
                .position(|s| s.repo == *repo && s.name == *name)
            {
                selected.remove(index);
            } else {
                ensure!(config.repos.contains(repo), "Repository is not configured");
                ensure!(
                    inventory
                        .repos
                        .get(repo)
                        .is_some_and(|skills| skills.iter().any(|s| s.name == *name)),
                    "Skill is not in the current repository inventory"
                );
                ensure!(
                    !selected.iter().any(|s| s.name == *name),
                    "Another selected repository has this Skill name"
                );
                selected.push(Selection {
                    repo: repo.clone(),
                    name: name.clone(),
                });
            }
            selections.set(*scope, &self.locations.project, selected)?;
        }
        if let Action::ToggleAgent(name) = &action {
            ensure!(
                config.agents.iter().any(|a| a.name == *name),
                "Unknown Agent"
            );
            if !disabled.remove(name) {
                disabled.insert(name.clone());
            }
            state::save_disabled(&self.locations, &disabled)?;
        }
        let mut changed = 0;
        // A failed source is unknown, not an authoritative empty inventory.
        for scope in [Scope::User, Scope::Project] {
            let Some(mut selected) = selections.get(scope, &self.locations.project).cloned() else {
                continue;
            };
            selected.retain(|s| {
                config.repos.contains(&s.repo)
                    && inventory
                        .repos
                        .get(&s.repo)
                        .is_none_or(|skills| skills.iter().any(|skill| skill.name == s.name))
            });
            selections.set(scope, &self.locations.project, selected)?;
        }
        // Save intent before touching deployed content.
        selections.save(&self.locations)?;
        for scope in [Scope::User, Scope::Project] {
            let Some(selected) = selections.get(scope, &self.locations.project) else {
                continue;
            };
            let shared = self.locations.shared(scope);
            for path in files::entries(&shared)? {
                let name = files::name(&path)?;
                if !selected.iter().any(|s| s.name == name) {
                    let meta = fs::symlink_metadata(&path)?;
                    if meta.is_dir() || meta.file_type().is_symlink() {
                        match files::remove(&path) {
                            Ok(()) => changed += 1,
                            Err(e) => errors.push(format!("{}: {e:#}", path.display())),
                        }
                    }
                }
            }
            for selection in selected {
                let Some(skill) = inventory
                    .repos
                    .get(&selection.repo)
                    .and_then(|skills| skills.iter().find(|s| s.name == selection.name))
                else {
                    continue;
                };
                let destination = shared.join(&selection.name);
                let refresh = matches!(action, Action::Update(s) if s == scope);
                if refresh || !destination.join("SKILL.md").is_file() {
                    match files::replace_tree(&skill.path, &destination, None) {
                        Ok(()) => changed += 1,
                        Err(e) => errors.push(format!("{}: {e:#}", destination.display())),
                    }
                }
            }
        }
        errors.extend(deployment::synchronize(&config, &disabled, &self.locations));
        Ok(Snapshot {
            config,
            selections,
            disabled,
            inventory,
            errors,
            changed,
        })
    }
}
