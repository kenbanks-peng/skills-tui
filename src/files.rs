//! Filesystem operations shared by installation and Agent Visibility.
use anyhow::{Context, Result, bail, ensure};
use std::{
    collections::BTreeSet,
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
};
use tempfile::NamedTempFile;

pub fn safe_name(name: &str) -> bool {
    let mut bytes = name.bytes();
    bytes.next().is_some_and(|c| c.is_ascii_alphanumeric())
        && bytes.all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}
pub fn exists(path: &Path) -> Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.into()),
    }
}
pub fn entries(path: &Path) -> Result<Vec<PathBuf>> {
    let iter = match fs::read_dir(path) {
        Ok(iter) => iter,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };
    let mut paths = iter
        .map(|entry| entry.map(|e| e.path()))
        .collect::<std::io::Result<Vec<_>>>()?;
    paths.sort();
    Ok(paths)
}
pub fn name(path: &Path) -> Result<String> {
    Ok(path
        .file_name()
        .context("Missing filename")?
        .to_str()
        .context("Filename is not UTF-8")?
        .to_owned())
}
pub fn lexical(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for part in path.components() {
        match part {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}
/// Resolve aliases of existing parents; never guess through a broken symlink.
pub fn physical(path: &Path) -> Result<PathBuf> {
    match fs::canonicalize(path) {
        Ok(p) => Ok(p),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            ensure!(
                !fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()),
                "Unresolved Skill Location: {}",
                path.display()
            );
            let parent = path.parent().context("Cannot resolve Skill Location")?;
            Ok(physical(parent)?.join(path.file_name().context("Missing filename")?))
        }
        Err(e) => Err(e.into()),
    }
}
pub fn link_target(path: &Path) -> Result<PathBuf> {
    let target = fs::read_link(path)?;
    let parent = fs::canonicalize(path.parent().context("Missing link parent")?)?;
    let absolute = lexical(&parent.join(target));
    // Do not resolve the last component: the shared entry itself can be a link.
    Ok(
        physical(absolute.parent().context("Missing target parent")?)?
            .join(absolute.file_name().context("Missing target name")?),
    )
}
pub fn atomic_write(path: &Path, content: &[u8]) -> Result<()> {
    let target = if exists(path)? {
        path.canonicalize()?
    } else {
        path.to_owned()
    };
    let parent = target.parent().context("Missing state parent")?;
    fs::create_dir_all(parent)?;
    let mut temp = NamedTempFile::new_in(parent)?;
    // NamedTempFile uses owner-only file permissions.
    temp.write_all(content)?;
    temp.as_file().sync_all()?;
    temp.persist(&target).map_err(|e| e.error)?;
    fs::File::open(parent)?.sync_all()?;
    Ok(())
}
pub fn remove(path: &Path) -> Result<()> {
    let meta = fs::symlink_metadata(path)?;
    if meta.is_dir() {
        fs::remove_dir_all(path)?;
    } else {
        fs::remove_file(path)?;
    }
    Ok(())
}
/// Dereference content links, reject cycles and special files.
pub fn copy_tree(source: &Path, destination: &Path) -> Result<()> {
    ensure!(
        !physical(destination)?.starts_with(source.canonicalize()?),
        "Copy destination must not be inside the source"
    );
    fn copy(source: &Path, destination: &Path, ancestors: &mut BTreeSet<PathBuf>) -> Result<()> {
        let resolved = source
            .canonicalize()
            .with_context(|| format!("Cannot read {}", source.display()))?;
        let meta = fs::metadata(&resolved)?;
        if meta.is_dir() {
            ensure!(
                ancestors.insert(resolved.clone()),
                "Content symlink cycle at {}",
                source.display()
            );
            fs::create_dir(destination)?;
            for entry in entries(source)? {
                copy(
                    &entry,
                    &destination.join(entry.file_name().unwrap()),
                    ancestors,
                )?;
            }
            ancestors.remove(&resolved);
            fs::set_permissions(destination, meta.permissions())?;
        } else if meta.is_file() {
            fs::copy(&resolved, destination)?;
        } else {
            bail!("Cannot copy special file: {}", source.display());
        }
        Ok(())
    }
    copy(source, destination, &mut BTreeSet::new())
}
/// Build before moving the old entry. Keep its backup if rollback fails.
pub fn replace_tree(source: &Path, destination: &Path, marker: Option<&[u8]>) -> Result<()> {
    let parent = destination.parent().context("Missing destination parent")?;
    ensure!(
        !physical(parent)?.starts_with(source.canonicalize()?),
        "Install destination must not be inside the source"
    );
    fs::create_dir_all(parent)?;
    let staging = tempfile::Builder::new()
        .prefix(".skills-tui-stage-")
        .tempdir_in(parent)?;
    let new = staging.path().join("new");
    let old = staging.path().join("old");
    copy_tree(source, &new)?;
    if let Some(content) = marker {
        // A source must not redirect marker writes outside the staged tree.
        let path = new.join(".skills-tui-copy.json");
        if exists(&path)? {
            remove(&path)?;
        }
        fs::write(path, content)?;
    }
    let previous = exists(destination)?;
    if previous {
        fs::rename(destination, &old)?;
    }
    if let Err(error) = fs::rename(&new, destination) {
        if previous && let Err(restore) = fs::rename(&old, destination) {
            let kept = staging.keep();
            bail!(
                "Install failed: {error}; rollback failed: {restore}. Backup: {}",
                kept.display()
            );
        }
        return Err(error.into());
    }
    Ok(())
}
#[cfg(unix)]
pub fn symlink(target: &Path, path: &Path) -> Result<()> {
    std::os::unix::fs::symlink(target, path)?;
    Ok(())
}
#[cfg(windows)]
pub fn symlink(target: &Path, path: &Path) -> Result<()> {
    std::os::windows::fs::symlink_dir(target, path)?;
    Ok(())
}
