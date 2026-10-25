use crate::{
    config::{Locations, Scope},
    files::{atomic_write, safe_name},
};
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Selection {
    pub repo: String,
    pub name: String,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Selections {
    #[serde(default)]
    pub skills: Scopes,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Scopes {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<Vec<Selection>>,
    #[serde(default)]
    pub projects: BTreeMap<String, Vec<Selection>>,
}
impl Selections {
    pub fn load(locations: &Locations) -> Result<Self> {
        let path = locations.state.join("skill-selections.toml");
        let state: Self = match fs::read_to_string(path) {
            Ok(text) => toml::from_str(&text)
                .context("Invalid Skill Selection state; no cleanup is permitted")?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Self::default(),
            Err(e) => return Err(e.into()),
        };
        if let Some(values) = &state.skills.user {
            validate(values)?;
        }
        for values in state.skills.projects.values() {
            validate(values)?;
        }
        Ok(state)
    }
    pub fn get(&self, scope: Scope, project: &Path) -> Option<&Vec<Selection>> {
        match scope {
            Scope::User => self.skills.user.as_ref(),
            Scope::Project => self
                .skills
                .projects
                .get(&project.to_string_lossy().to_string()),
        }
    }
    pub fn set(&mut self, scope: Scope, project: &Path, values: Vec<Selection>) -> Result<()> {
        validate(&values)?;
        match scope {
            Scope::User => self.skills.user = Some(values),
            Scope::Project => {
                self.skills
                    .projects
                    .insert(project.to_string_lossy().to_string(), values);
            }
        }
        Ok(())
    }
    pub fn save(&self, locations: &Locations) -> Result<()> {
        atomic_write(
            &locations.state.join("skill-selections.toml"),
            toml::to_string_pretty(self)?.as_bytes(),
        )
    }
}
fn validate(values: &[Selection]) -> Result<()> {
    let mut names = BTreeSet::new();
    for s in values {
        ensure!(
            safe_name(&s.name) && !s.repo.is_empty(),
            "Invalid Skill Selection"
        );
        ensure!(
            names.insert(&s.name),
            "A scope cannot select the same Skill name twice"
        );
    }
    Ok(())
}
pub fn load_disabled(locations: &Locations) -> Result<BTreeSet<String>> {
    match fs::read_to_string(locations.state.join("disabled-agents.json")) {
        Ok(text) => Ok(serde_json::from_str(&text).context("Invalid disabled Agent state")?),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(BTreeSet::new()),
        Err(e) => Err(e.into()),
    }
}
pub fn save_disabled(locations: &Locations, disabled: &BTreeSet<String>) -> Result<()> {
    atomic_write(
        &locations.state.join("disabled-agents.json"),
        &serde_json::to_vec(disabled)?,
    )
}
