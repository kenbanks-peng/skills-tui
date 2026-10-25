#![cfg(unix)]
use skills_tui::{
    config::{Config, Locations, Scope},
    deployment, files,
};
use std::{collections::BTreeSet, fs, path::Path};

fn setup(extra: &str) -> (tempfile::TempDir, Locations, Config) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    let locations = Locations::new(root.join("home"), root.join("project"));
    locations.initialize().unwrap();
    fs::create_dir_all(&locations.project).unwrap();
    fs::write(&locations.config, format!("repos = []\n{extra}")).unwrap();
    let config = Config::load(&locations.config).unwrap();
    (temp, locations, config)
}
fn skill(path: &Path) {
    fs::create_dir_all(path).unwrap();
    fs::write(path.join("SKILL.md"), "# Test").unwrap();
}
#[test]
fn stale_relative_links_under_dotfiles_aliases_are_repaired() {
    let (_temp, locations, config) = setup("[agents]\nenabled=['claude-code']\n");
    let physical = locations.home.join("dotfiles/claude/skills");
    fs::create_dir_all(&physical).unwrap();
    files::symlink(physical.parent().unwrap(), &locations.home.join(".claude")).unwrap();
    let destination = locations.home.join(".claude/skills/alpha");
    files::symlink(Path::new("../../.agents/skills/alpha"), &destination).unwrap();
    skill(&locations.shared(Scope::User).join("alpha"));
    assert!(!destination.exists());
    let errors = deployment::synchronize(&config, &BTreeSet::new(), &locations);
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(
        fs::read_link(destination).unwrap(),
        locations.shared(Scope::User).join("alpha")
    );
}
#[test]
fn dead_shared_links_are_removed_even_for_universal_agents() {
    let (_temp, locations, config) =
        setup("[agents]\nenabled=['pi']\n[agents.universal]\nboth=['pi']\n");
    let directory = locations.agent_dir(&config.agents[0], Scope::User);
    fs::create_dir_all(&directory).unwrap();
    let missing = directory.join("gone");
    let unrelated = directory.join("unrelated");
    files::symlink(&locations.shared(Scope::User).join("gone"), &missing).unwrap();
    files::symlink(&locations.home.join("unrelated"), &unrelated).unwrap();
    let errors = deployment::synchronize(&config, &BTreeSet::new(), &locations);
    assert!(errors.is_empty(), "{errors:?}");
    assert!(!files::exists(&missing).unwrap());
    assert!(files::exists(&unrelated).unwrap());
}
#[test]
fn disable_preserves_a_location_used_by_another_selected_agent() {
    let (_temp, locations, config) = setup(
        "[[custom-agents]]\nname='first'\nlocal='.same/skills'\nglobal='~/.same/skills'\n[[custom-agents]]\nname='second'\nlocal='.same/skills'\nglobal='~/.same/skills'\n",
    );
    skill(&locations.shared(Scope::User).join("alpha"));
    assert!(deployment::synchronize(&config, &BTreeSet::new(), &locations).is_empty());
    assert!(
        deployment::synchronize(&config, &BTreeSet::from(["first".into()]), &locations).is_empty()
    );
    assert!(locations.home.join(".same/skills/alpha/SKILL.md").is_file());
}
#[test]
fn recursive_copy_destination_is_rejected_before_creation() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().canonicalize().unwrap();
    let destination = source.join("nested");
    assert!(files::copy_tree(&source, &destination).is_err());
    assert!(!destination.exists());
}
