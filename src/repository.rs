//! Native discovery: local paths and cached Git checkouts. No JavaScript runtime.
use crate::{
    config::Locations,
    files::{atomic_write, safe_name},
};
use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use url::Url;
use walkdir::WalkDir;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Skill {
    pub name: String,
    pub path: PathBuf,
    pub description: String,
}
#[derive(Clone, Debug, Default)]
pub struct Inventory {
    pub repos: BTreeMap<String, Vec<Skill>>,
    pub errors: Vec<String>,
}
#[derive(Deserialize, Serialize)]
struct Stamp {
    repo: String,
    seconds: u64,
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn cache_key(value: &str) -> String {
    // Stable FNV-1a, with full repository identity checked in the stamp.
    let hash = value.bytes().fold(0xcbf29ce484222325u64, |h, b| {
        (h ^ u64::from(b)).wrapping_mul(0x100000001b3)
    });
    format!("{hash:016x}")
}
fn git(args: &[&str], cwd: Option<&Path>) -> Result<()> {
    let mut command = Command::new("git");
    command
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_SSH_COMMAND", "ssh -oBatchMode=yes -oConnectTimeout=15")
        .env("GIT_CONFIG_COUNT", "1")
        .env("GIT_CONFIG_KEY_0", "http.connectTimeout")
        .env("GIT_CONFIG_VALUE_0", "15")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    // A stalled remote must not block all future synchronization requests.
    let errors = tempfile::NamedTempFile::new()?;
    command.stderr(errors.reopen()?);
    let mut child = command
        .spawn()
        .context("Git is required to read remote repositories")?;
    let started = std::time::Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if started.elapsed() >= Duration::from_secs(90) {
            let _ = child.kill();
            let _ = child.wait();
            bail!("Git repository check timed out after 90 seconds");
        }
        std::thread::sleep(Duration::from_millis(25));
    };
    ensure!(
        status.success(),
        "Git failed: {}",
        fs::read_to_string(errors.path())?.trim()
    );
    Ok(())
}
pub fn checkout(
    locations: &Locations,
    repo: &str,
    expiry_hours: f64,
    force: bool,
) -> Result<PathBuf> {
    if repo.starts_with("file://") {
        return Url::parse(repo)?
            .to_file_path()
            .map_err(|_| anyhow::anyhow!("Invalid file URL"));
    }
    let remote =
        if repo.starts_with("https://") || repo.starts_with("ssh://") || repo.starts_with("git@") {
            repo.to_owned()
        } else {
            let parts: Vec<_> = repo.split('/').collect();
            ensure!(
                parts.len() == 2
                    && parts.iter().all(|s| !s.is_empty()
                        && s.bytes()
                            .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c)))
                    && !repo.starts_with('-'),
                "Use owner/repo, a Git URL, or a file URL"
            );
            format!("https://github.com/{repo}.git")
        };
    let key = cache_key(repo);
    let path = locations.cache.join(format!("repo-{key}"));
    let stamp_path = locations.cache.join(format!("repo-{key}.json"));
    let stamp: Option<Stamp> = fs::read(&stamp_path)
        .ok()
        .and_then(|s| serde_json::from_slice(&s).ok());
    if let Some(stamp) = &stamp {
        ensure!(stamp.repo == repo, "Repository cache key conflict");
    }
    let fresh = stamp.is_some_and(|s| {
        now().saturating_sub(s.seconds)
            < Duration::from_secs_f64((expiry_hours * 3600.0).min(315_360_000.0)).as_secs()
    });
    if path.join(".git").is_dir() {
        if !fresh || force {
            git(&["fetch", "--depth", "1", "origin", "HEAD"], Some(&path))?;
            git(&["reset", "--hard", "FETCH_HEAD"], Some(&path))?;
        }
    } else {
        fs::create_dir_all(&locations.cache)?;
        let staging = tempfile::Builder::new()
            .prefix("clone-")
            .tempdir_in(&locations.cache)?;
        let temp = staging.path().join("repository");
        git(
            &[
                "clone",
                "--depth",
                "1",
                "--",
                &remote,
                temp.to_str().context("Invalid cache path")?,
            ],
            None,
        )?;
        fs::rename(temp, &path)?;
    }
    atomic_write(
        &stamp_path,
        &serde_json::to_vec(&Stamp {
            repo: repo.into(),
            seconds: if fresh && !force {
                fs::read(&stamp_path)
                    .ok()
                    .and_then(|s| serde_json::from_slice::<Stamp>(&s).ok())
                    .map_or(now(), |s| s.seconds)
            } else {
                now()
            },
        })?,
    )?;
    Ok(path)
}
#[derive(Deserialize)]
struct Metadata {
    name: Option<String>,
    #[serde(default)]
    description: String,
}
pub fn discover(directory: &Path) -> Result<Vec<Skill>> {
    ensure!(
        directory.is_dir(),
        "Repository is not a directory: {}",
        directory.display()
    );
    let mut skills = BTreeMap::<String, Skill>::new();
    let walker = WalkDir::new(directory)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            e.depth() == 0
                || !e.file_name().to_string_lossy().starts_with('.')
                    && e.file_name() != "node_modules"
                    && e.file_name() != "target"
        });
    for entry in walker {
        let entry = entry?;
        if entry.file_name() != "SKILL.md" || !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path().parent().context("Missing Skill directory")?;
        let text = fs::read_to_string(entry.path())?;
        let (name, description) = parse_metadata(&text, path)?;
        ensure!(safe_name(&name), "Unsafe Skill name: {name}");
        if let Some(previous) = skills.get(&name) {
            bail!(
                "Duplicate Skill name {name}: {} and {}",
                previous.path.display(),
                path.display()
            );
        }
        skills.insert(
            name.clone(),
            Skill {
                name,
                path: path.to_owned(),
                description,
            },
        );
    }
    Ok(skills.into_values().collect())
}
fn parse_metadata(text: &str, path: &Path) -> Result<(String, String)> {
    let fallback = path
        .file_name()
        .context("Missing Skill name")?
        .to_string_lossy()
        .to_string();
    let mut metadata = Metadata {
        name: None,
        description: String::new(),
    };
    if let Some(rest) = text
        .strip_prefix("---\n")
        .or_else(|| text.strip_prefix("---\r\n"))
    {
        let lines = rest
            .lines()
            .take_while(|line| line.trim() != "---")
            .collect::<Vec<_>>();
        ensure!(
            rest.lines().any(|line| line.trim() == "---"),
            "Unclosed Skill front matter: {}",
            path.display()
        );
        metadata = serde_yaml_ng::from_str(&lines.join("\n"))
            .with_context(|| format!("Invalid Skill front matter: {}", path.display()))?;
    }
    Ok((metadata.name.unwrap_or(fallback), metadata.description))
}
pub fn inventory(locations: &Locations, repos: &[String], expiry: f64, force: bool) -> Inventory {
    let mut inventory = Inventory::default();
    for repo in repos {
        match checkout(locations, repo, expiry, force).and_then(|p| discover(&p)) {
            Ok(skills) => {
                inventory.repos.insert(repo.clone(), skills);
            }
            Err(e) => inventory.errors.push(format!("{repo}: {e:#}")),
        }
    }
    inventory
}
