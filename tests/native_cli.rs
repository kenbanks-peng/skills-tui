//! Exercise real Git and the compiled CLI without a network or live HOME.
use skills_tui::{
    config::{Locations, Scope},
    state::{Selection, Selections},
};
use std::{fs, path::Path, process::Command};

fn git(directory: &Path, args: &[&str]) {
    let output = Command::new("git")
        .current_dir(directory)
        .args([
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "-c",
            "commit.gpgsign=false",
        ])
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}
#[test]
fn cli_clones_and_refreshes_remote_cache_without_node() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    let locations = Locations::new(root.join("home"), root.join("project"));
    locations.initialize().unwrap();
    fs::create_dir_all(&locations.project).unwrap();
    let remote = root.join("remote");
    fs::create_dir_all(remote.join("skills/alpha")).unwrap();
    fs::write(
        remote.join("skills/alpha/SKILL.md"),
        "---\nname: alpha\ndescription: First\n---\n",
    )
    .unwrap();
    git(&remote, &["init", "--initial-branch=main"]);
    git(&remote, &["add", "."]);
    git(&remote, &["commit", "-m", "initial"]);
    // Rewrite a reserved HTTPS hostname to a local Git repository.
    let global = root.join("gitconfig");
    fs::write(
        &global,
        format!(
            "[url \"{}\"]\n  insteadOf = https://skills.invalid/repo.git\n",
            url::Url::from_directory_path(&remote).unwrap()
        ),
    )
    .unwrap();
    let repo = "https://skills.invalid/repo.git";
    fs::write(&locations.config, format!("repos = ['{repo}']\n")).unwrap();
    let mut state = Selections::default();
    state
        .set(
            Scope::User,
            &locations.project,
            vec![Selection {
                repo: repo.into(),
                name: "alpha".into(),
            }],
        )
        .unwrap();
    state.save(&locations).unwrap();
    let sync = || {
        let output = Command::new(env!("CARGO_BIN_EXE_skills-tui"))
            .arg("--sync")
            .current_dir(&locations.project)
            .env("HOME", &locations.home)
            .env("GIT_CONFIG_GLOBAL", &global)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    };
    sync();
    let installed = locations.shared(Scope::User).join("alpha");
    assert!(
        fs::read_to_string(installed.join("SKILL.md"))
            .unwrap()
            .contains("First")
    );
    fs::write(
        remote.join("skills/alpha/SKILL.md"),
        "---\nname: alpha\ndescription: Second\n---\n",
    )
    .unwrap();
    git(&remote, &["add", "."]);
    git(&remote, &["commit", "-m", "second"]);
    for entry in fs::read_dir(&locations.cache).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_some_and(|e| e == "json") {
            let mut stamp: serde_json::Value =
                serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
            stamp["seconds"] = 0.into();
            fs::write(path, serde_json::to_vec(&stamp).unwrap()).unwrap();
        }
    }
    fs::remove_dir_all(&installed).unwrap();
    sync();
    assert!(
        fs::read_to_string(installed.join("SKILL.md"))
            .unwrap()
            .contains("Second")
    );
}
#[test]
fn help_does_not_create_configuration() {
    let temp = tempfile::tempdir().unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_skills-tui"))
        .arg("--help")
        .env("HOME", temp.path())
        .output()
        .unwrap();
    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).contains("--sync"));
    assert!(!temp.path().join(".config").exists());
}
#[test]
fn unknown_arguments_fail() {
    let output = Command::new(env!("CARGO_BIN_EXE_skills-tui"))
        .arg("--unknown")
        .output()
        .unwrap();
    assert!(!output.status.success());
}
