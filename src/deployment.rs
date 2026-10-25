use crate::{
    config::{Agent, Config, Locations, Mode, Scope},
    files,
};
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
};

const MARKER: &str = ".skills-tui-copy.json";
#[derive(Deserialize, Serialize)]
struct Ownership {
    version: u8,
    source: PathBuf,
}
fn owned(path: &Path, source: &Path) -> Result<bool> {
    if !files::exists(path)? {
        return Ok(false);
    }
    let meta = fs::symlink_metadata(path)?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Ok(false);
    }
    match fs::read(path.join(MARKER)) {
        Ok(bytes) => Ok(serde_json::from_slice::<Ownership>(&bytes)
            .is_ok_and(|o| o.version == 1 && o.source == source)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.into()),
    }
}
fn missing(path: &Path) -> Result<bool> {
    match fs::metadata(path) {
        Ok(_) => Ok(false),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(true),
        Err(e) => Err(e.into()),
    }
}
fn managed_link(path: &Path, shared: &Path, target: &Path) -> Result<bool> {
    if !fs::symlink_metadata(path)?.file_type().is_symlink() {
        return Ok(false);
    }
    let physical_target = files::physical(shared)?.join(target.file_name().unwrap());
    if files::link_target(path)? == physical_target {
        return Ok(true);
    }
    // Repair a relative link that broke when a parent moved into dotfiles.
    let link = fs::read_link(path)?;
    Ok(!link.is_absolute()
        && files::lexical(&path.parent().unwrap().join(link)) == files::lexical(target)
        && missing(path)?)
}
/// Recheck link identity immediately before removing it. Never recurse into it.
fn remove_link(path: &Path, expected: &Path, missing_only: bool) -> Result<()> {
    let before = fs::symlink_metadata(path)?;
    let link = fs::read_link(path)?;
    let target = files::link_target(path)?;
    ensure!(target == expected, "Skill link changed; left unchanged");
    let after = fs::symlink_metadata(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        ensure!(
            before.dev() == after.dev()
                && before.ino() == after.ino()
                && before.ctime() == after.ctime()
                && before.ctime_nsec() == after.ctime_nsec(),
            "Skill link changed; left unchanged"
        );
    }
    ensure!(
        after.file_type().is_symlink()
            && fs::read_link(path)? == link
            && files::link_target(path)? == expected,
        "Skill link changed; left unchanged"
    );
    ensure!(
        !missing_only || missing(path)?,
        "Link target is no longer missing; left unchanged"
    );
    fs::remove_file(path)?;
    Ok(())
}
fn clean_dead_links(directory: &Path, shared: &Path) -> Result<()> {
    let shared = files::physical(shared)?;
    for path in files::entries(directory)? {
        if !fs::symlink_metadata(&path)?.file_type().is_symlink() {
            continue;
        }
        let target = files::link_target(&path)?;
        if target != shared && target.starts_with(&shared) && missing(&path)? {
            remove_link(&path, &target, true)?;
        }
    }
    Ok(())
}
fn synchronize_one(
    agent: &Agent,
    config: &Config,
    disabled: &BTreeSet<String>,
    locations: &Locations,
    scope: Scope,
) -> Result<()> {
    let enabled = !disabled.contains(&agent.name);
    let shared = locations.shared(scope);
    let directory = locations.agent_dir(agent, scope);
    let physical_shared = files::physical(&shared)?;
    let physical_directory = files::physical(&directory)?;
    if !enabled {
        for other in &config.agents {
            if other.name != agent.name
                && !disabled.contains(&other.name)
                && files::physical(&locations.agent_dir(other, scope))? == physical_directory
            {
                return Ok(());
            }
        }
    }
    clean_dead_links(&directory, &shared)?;
    if agent.mode == Mode::Symlink
        && (config.universal(&agent.name, scope) || physical_directory == physical_shared)
    {
        return Ok(());
    }
    if agent.mode == Mode::Copy {
        ensure!(
            !physical_directory.starts_with(&physical_shared)
                && !physical_shared.starts_with(&physical_directory),
            "Copy Skill Location must not overlap the shared Skill Location"
        );
    }
    // Unavailable shared content is not proof of stale copies.
    if enabled && !shared.exists() {
        return Ok(());
    }
    let present = files::entries(&shared)?;
    let present_names: BTreeSet<_> = present
        .iter()
        .filter_map(|p| p.file_name().map(|n| n.to_owned()))
        .collect();
    let mut errors = Vec::new();
    for path in files::entries(&directory)? {
        let name = files::name(&path)?;
        if name.starts_with('.') {
            continue;
        }
        let source = shared.join(&name);
        let result = (|| -> Result<()> {
            if agent.mode == Mode::Copy {
                if (!enabled || !present_names.contains(path.file_name().unwrap()))
                    && owned(&path, &source)?
                {
                    files::remove(&path)?;
                }
            } else if fs::symlink_metadata(&path)?.file_type().is_symlink() {
                let target = files::link_target(&path)?;
                // Delete only shared links, and only if disabled or confirmed missing.
                if (target.starts_with(&physical_shared)
                    && target != physical_shared
                    && (!enabled || missing(&path)?))
                    || (!enabled && managed_link(&path, &shared, &source)?)
                {
                    remove_link(&path, &target, false)?;
                }
            }
            Ok(())
        })();
        if let Err(e) = result {
            errors.push(format!("{}: {e:#}", path.display()));
        }
    }
    if enabled {
        for source in present {
            let name = files::name(&source)?;
            if name.starts_with('.') {
                continue;
            }
            let destination = directory.join(&name);
            let result = (|| -> Result<()> {
                ensure!(
                    source.join("SKILL.md").is_file(),
                    "Shared Skill Instance is unavailable: {}",
                    source.display()
                );
                if agent.mode == Mode::Copy {
                    if files::exists(&destination)? {
                        ensure!(
                            owned(&destination, &source)?
                                || managed_link(&destination, &shared, &source)?,
                            "Skill Location contains an independent entry; left unchanged"
                        );
                    }
                    let marker = serde_json::to_vec(&Ownership {
                        version: 1,
                        source: source.clone(),
                    })?;
                    files::replace_tree(&source, &destination, Some(&marker))?;
                } else {
                    if files::exists(&destination)? {
                        ensure!(
                            managed_link(&destination, &shared, &source)?,
                            "Skill Location contains an unrelated entry; left unchanged"
                        );
                        if destination.join("SKILL.md").is_file() {
                            return Ok(());
                        }
                        let target = files::link_target(&destination)?;
                        remove_link(&destination, &target, false)?;
                    }
                    fs::create_dir_all(&directory)?;
                    files::symlink(&source, &destination)?;
                }
                Ok(())
            })();
            if let Err(e) = result {
                errors.push(format!("{}: {e:#}", destination.display()));
            }
        }
    }
    ensure!(errors.is_empty(), "{}", errors.join("\n"));
    Ok(())
}
pub fn synchronize(
    config: &Config,
    disabled: &BTreeSet<String>,
    locations: &Locations,
) -> Vec<String> {
    let mut errors = Vec::new();
    for agent in &config.agents {
        for scope in [Scope::User, Scope::Project] {
            if let Err(e) = synchronize_one(agent, config, disabled, locations, scope) {
                errors.push(format!("{} ({}): {e:#}", agent.display, scope.label()));
            }
        }
    }
    errors
}
pub fn visible(
    agent: &Agent,
    config: &Config,
    locations: &Locations,
    scope: Scope,
    name: &str,
) -> bool {
    if agent.mode != Mode::Copy && config.universal(&agent.name, scope) {
        locations
            .shared(scope)
            .join(name)
            .join("SKILL.md")
            .is_file()
    } else {
        locations
            .agent_dir(agent, scope)
            .join(name)
            .join("SKILL.md")
            .is_file()
    }
}
