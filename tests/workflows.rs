use skills_tui::{
    config::{Config, Locations, Mode, Scope},
    deployment, files,
    manager::{Action, Manager},
    repository,
    state::{Selection, Selections},
};
use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
};

struct Fixture {
    _temp: tempfile::TempDir,
    locations: Locations,
    repo: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        // Canonicalize for macOS /var aliases.
        let root = temp.path().canonicalize().unwrap();
        let locations = Locations::new(root.join("home"), root.join("project"));
        fs::create_dir_all(&locations.project).unwrap();
        locations.initialize().unwrap();
        let repo = root.join("repository");
        fs::create_dir(&repo).unwrap();
        let fixture = Self {
            _temp: temp,
            locations,
            repo,
        };
        fixture.configure("");
        fixture
    }
    fn url(&self) -> String {
        url::Url::from_directory_path(&self.repo)
            .unwrap()
            .to_string()
    }
    fn configure(&self, extra: &str) {
        fs::write(
            &self.locations.config,
            format!("repos = [{}]\n{extra}", toml::Value::String(self.url())),
        )
        .unwrap();
    }
    fn skill(&self, name: &str) {
        skill(&self.repo.join(name), name);
    }
    fn shared(&self, scope: Scope, name: &str) -> PathBuf {
        self.locations.shared(scope).join(name)
    }
    fn select(&self, scope: Scope, names: &[&str]) {
        let mut state = Selections::load(&self.locations).unwrap();
        state
            .set(
                scope,
                &self.locations.project,
                names
                    .iter()
                    .map(|name| Selection {
                        repo: self.url(),
                        name: (*name).into(),
                    })
                    .collect(),
            )
            .unwrap();
        state.save(&self.locations).unwrap();
    }
    fn manager(&self) -> Manager {
        Manager::open(self.locations.clone()).unwrap()
    }
}
fn skill(path: &Path, name: &str) {
    fs::create_dir_all(path).unwrap();
    fs::write(
        path.join("SKILL.md"),
        format!("---\nname: {name}\ndescription: Test skill\n---\n# {name}\n"),
    )
    .unwrap();
}
#[test]
fn adopts_installed_instances_and_restores_missing_selected_content() {
    let f = Fixture::new();
    f.skill("alpha");
    skill(&f.shared(Scope::User, "alpha"), "alpha");
    let original = fs::read(&f.locations.config).unwrap();
    let mut manager = f.manager();
    assert!(manager.run(Action::Synchronize).unwrap().errors.is_empty());
    let state = Selections::load(&f.locations).unwrap();
    assert_eq!(
        state.get(Scope::User, &f.locations.project).unwrap()[0].name,
        "alpha"
    );
    fs::remove_dir_all(f.shared(Scope::User, "alpha")).unwrap();
    assert_eq!(manager.run(Action::Synchronize).unwrap().changed, 1);
    assert!(f.shared(Scope::User, "alpha").join("SKILL.md").is_file());
    assert_eq!(fs::read(&f.locations.config).unwrap(), original);
}
#[test]
fn empty_scope_does_not_adopt_and_scopes_are_independent() {
    let f = Fixture::new();
    f.skill("alpha");
    skill(&f.shared(Scope::User, "alpha"), "alpha");
    skill(&f.shared(Scope::Project, "alpha"), "alpha");
    f.select(Scope::User, &[]);
    let mut manager = f.manager();
    manager.run(Action::Synchronize).unwrap();
    assert!(!f.shared(Scope::User, "alpha").exists());
    assert!(f.shared(Scope::Project, "alpha").exists());
    let mut state = Selections::load(&f.locations).unwrap();
    assert!(
        state
            .get(Scope::User, &f.locations.project)
            .unwrap()
            .is_empty()
    );
    state
        .set(Scope::Project, Path::new("/another-project"), Vec::new())
        .unwrap();
    state.save(&f.locations).unwrap();
    manager
        .run(Action::Toggle {
            repo: f.url(),
            name: "alpha".into(),
            scope: Scope::User,
        })
        .unwrap();
    assert!(
        Selections::load(&f.locations)
            .unwrap()
            .get(Scope::Project, Path::new("/another-project"))
            .is_some()
    );
}
#[test]
fn failed_repository_checks_preserve_selections_and_instances() {
    let f = Fixture::new();
    f.select(Scope::User, &["alpha"]);
    skill(&f.shared(Scope::User, "alpha"), "alpha");
    fs::remove_dir(&f.repo).unwrap();
    let before = fs::read(f.locations.state.join("skill-selections.toml")).unwrap();
    let result = f.manager().run(Action::Synchronize).unwrap();
    assert!(!result.errors.is_empty());
    assert!(f.shared(Scope::User, "alpha").is_dir());
    assert_eq!(
        fs::read(f.locations.state.join("skill-selections.toml")).unwrap(),
        before
    );
}
#[test]
fn failed_discovery_does_not_finish_first_run_adoption() {
    let f = Fixture::new();
    skill(&f.shared(Scope::User, "independent"), "independent");
    fs::remove_dir(&f.repo).unwrap();
    f.manager().run(Action::Synchronize).unwrap();
    assert!(
        Selections::load(&f.locations)
            .unwrap()
            .get(Scope::User, &f.locations.project)
            .is_none()
    );
    assert!(f.shared(Scope::User, "independent").is_dir());
}
#[test]
fn invalid_state_stops_cleanup() {
    let f = Fixture::new();
    skill(&f.shared(Scope::User, "alpha"), "alpha");
    fs::write(
        f.locations.state.join("skill-selections.toml"),
        "[skills]\nuser = 'wrong'\n",
    )
    .unwrap();
    assert!(f.manager().run(Action::Synchronize).is_err());
    assert!(f.shared(Scope::User, "alpha").is_dir());
}
#[test]
fn invalid_project_state_also_stops_user_cleanup() {
    let f = Fixture::new();
    skill(&f.shared(Scope::User, "alpha"), "alpha");
    fs::write(
        f.locations.state.join("skill-selections.toml"),
        "[skills]\nuser = []\n[skills.projects]\n'/other' = [{repo='x',name='../unsafe'}]\n",
    )
    .unwrap();
    assert!(f.manager().run(Action::Synchronize).is_err());
    assert!(f.shared(Scope::User, "alpha").is_dir());
}
#[test]
fn confirmed_obsolete_skills_are_removed() {
    let f = Fixture::new();
    f.select(Scope::User, &["alpha"]);
    skill(&f.shared(Scope::User, "alpha"), "alpha");
    let result = f.manager().run(Action::Synchronize).unwrap();
    assert_eq!(result.changed, 1);
    assert!(
        Selections::load(&f.locations)
            .unwrap()
            .get(Scope::User, &f.locations.project)
            .unwrap()
            .is_empty()
    );
    assert!(!f.shared(Scope::User, "alpha").exists());
}
#[test]
fn toggle_saves_intent_and_update_refreshes_only_requested_scope() {
    let f = Fixture::new();
    f.skill("alpha");
    let mut manager = f.manager();
    for scope in [Scope::User, Scope::Project] {
        let result = manager
            .run(Action::Toggle {
                repo: f.url(),
                name: "alpha".into(),
                scope,
            })
            .unwrap();
        assert!(result.errors.is_empty(), "{:?}", result.errors);
    }
    fs::write(f.repo.join("alpha/SKILL.md"), "# Updated").unwrap();
    manager.run(Action::Update(Scope::User)).unwrap();
    assert_eq!(
        fs::read_to_string(f.shared(Scope::User, "alpha").join("SKILL.md")).unwrap(),
        "# Updated"
    );
    assert_ne!(
        fs::read_to_string(f.shared(Scope::Project, "alpha").join("SKILL.md")).unwrap(),
        "# Updated"
    );
    manager
        .run(Action::Toggle {
            repo: f.url(),
            name: "alpha".into(),
            scope: Scope::User,
        })
        .unwrap();
    assert!(!f.shared(Scope::User, "alpha").exists());
    assert!(f.shared(Scope::Project, "alpha").exists());
}
#[test]
fn duplicate_repository_names_stop_adoption() {
    let f = Fixture::new();
    f.skill("alpha");
    let second = f.repo.parent().unwrap().join("second");
    skill(&second.join("alpha"), "alpha");
    let other = url::Url::from_directory_path(second).unwrap().to_string();
    fs::write(
        &f.locations.config,
        format!(
            "repos = [{}, {}]",
            toml::Value::String(f.url()),
            toml::Value::String(other)
        ),
    )
    .unwrap();
    skill(&f.shared(Scope::User, "alpha"), "alpha");
    let result = f.manager().run(Action::Synchronize).unwrap();
    assert!(!result.errors.is_empty());
    assert!(
        Selections::load(&f.locations)
            .unwrap()
            .get(Scope::User, &f.locations.project)
            .is_none()
    );
    assert!(f.shared(Scope::User, "alpha").exists());
}
#[test]
fn lock_prevents_two_managers_from_mutating_the_same_state() {
    let f = Fixture::new();
    let _manager = f.manager();
    assert!(Manager::open(f.locations.clone()).is_err());
}
#[test]
fn nested_discovery_reads_yaml_and_rejects_unsafe_names() {
    let f = Fixture::new();
    let nested = f.repo.join("skills/category/alpha");
    skill(&nested, "alpha");
    fs::write(
        nested.join("SKILL.md"),
        "---\nname: alpha\ndescription: >-\n  A multiline\n  description\n---\n",
    )
    .unwrap();
    let skills = repository::discover(&f.repo).unwrap();
    assert_eq!(skills.len(), 1);
    assert_eq!(skills[0].description, "A multiline description");
    skill(&nested, "../escape");
    assert!(repository::discover(&f.repo).is_err());
}
#[test]
fn duplicate_names_within_a_repository_are_not_authoritative() {
    let f = Fixture::new();
    skill(&f.repo.join("a/alpha"), "alpha");
    skill(&f.repo.join("b/alpha"), "alpha");
    assert!(repository::discover(&f.repo).is_err());
}
#[test]
fn custom_agent_overrides_builtin_and_copy_mode_wins_over_universal() {
    let f = Fixture::new();
    f.configure("[agents]\nenabled = ['pi']\n[agents.universal]\nboth = ['pi']\n[[custom-agents]]\nname = 'pi'\nlocal = '.portable/skills'\nglobal = '~/.portable/skills'\nmode = 'copy'\n");
    let config = Config::load(&f.locations.config).unwrap();
    assert_eq!(config.agents.len(), 1);
    assert_eq!(config.agents[0].mode, Mode::Copy);
    skill(&f.shared(Scope::User, "alpha"), "alpha");
    assert!(deployment::synchronize(&config, &BTreeSet::new(), &f.locations).is_empty());
    assert!(
        f.locations
            .home
            .join(".portable/skills/alpha/.skills-tui-copy.json")
            .is_file()
    );
}
#[cfg(unix)]
#[test]
fn agent_disable_removes_only_shared_links() {
    let f = Fixture::new();
    f.configure("[agents]\nenabled = ['claude-code']\n");
    let config = Config::load(&f.locations.config).unwrap();
    skill(&f.shared(Scope::User, "alpha"), "alpha");
    let directory = f.locations.home.join(".claude/skills");
    skill(&directory.join("independent"), "independent");
    let outside = f.repo.join("external");
    skill(&outside, "external");
    files::symlink(&outside, &directory.join("external")).unwrap();
    assert!(deployment::synchronize(&config, &BTreeSet::new(), &f.locations).is_empty());
    assert!(
        fs::symlink_metadata(directory.join("alpha"))
            .unwrap()
            .file_type()
            .is_symlink()
    );
    assert!(
        deployment::synchronize(
            &config,
            &BTreeSet::from(["claude-code".into()]),
            &f.locations
        )
        .is_empty()
    );
    assert!(!directory.join("alpha").exists());
    assert!(directory.join("independent").is_dir());
    assert!(directory.join("external").is_dir());
}
#[cfg(unix)]
#[test]
fn agent_conflicts_are_preserved_and_reported() {
    let f = Fixture::new();
    f.configure("[agents]\nenabled = ['claude-code']\n");
    let config = Config::load(&f.locations.config).unwrap();
    skill(&f.shared(Scope::User, "alpha"), "alpha");
    let path = f.locations.home.join(".claude/skills/alpha");
    skill(&path, "independent");
    assert!(!deployment::synchronize(&config, &BTreeSet::new(), &f.locations).is_empty());
    assert!(
        fs::read_to_string(path.join("SKILL.md"))
            .unwrap()
            .contains("independent")
    );
}
#[cfg(unix)]
#[test]
fn copies_are_self_contained_and_only_owned_copies_are_removed() {
    let f = Fixture::new();
    f.configure("[[custom-agents]]\nname='portable'\nlocal='.portable/skills'\nglobal='~/.portable/skills'\nmode='copy'\n");
    let config = Config::load(&f.locations.config).unwrap();
    let source = f.shared(Scope::User, "alpha");
    skill(&source, "alpha");
    let asset = f.repo.join("asset");
    fs::write(&asset, "content").unwrap();
    files::symlink(&asset, &source.join("asset")).unwrap();
    let target = f.locations.home.join(".portable/skills");
    skill(&target.join("independent"), "independent");
    assert!(deployment::synchronize(&config, &BTreeSet::new(), &f.locations).is_empty());
    assert!(
        !fs::symlink_metadata(target.join("alpha/asset"))
            .unwrap()
            .file_type()
            .is_symlink()
    );
    fs::remove_file(asset).unwrap();
    assert_eq!(
        fs::read_to_string(target.join("alpha/asset")).unwrap(),
        "content"
    );
    assert!(
        deployment::synchronize(&config, &BTreeSet::from(["portable".into()]), &f.locations)
            .is_empty()
    );
    assert!(!target.join("alpha").exists());
    assert!(target.join("independent").exists());
}
#[test]
fn copy_location_overlap_is_rejected() {
    let f = Fixture::new();
    f.configure("[[custom-agents]]\nname='bad'\nlocal='.agents/skills/nested'\nglobal='~/.agents'\nmode='copy'\n");
    let config = Config::load(&f.locations.config).unwrap();
    assert_eq!(
        deployment::synchronize(&config, &BTreeSet::new(), &f.locations).len(),
        2
    );
}
#[cfg(unix)]
#[test]
fn content_cycles_fail_without_replacing_old_installation() {
    let f = Fixture::new();
    f.skill("alpha");
    let source = f.repo.join("alpha");
    files::symlink(&source, &source.join("cycle")).unwrap();
    let target = f.shared(Scope::User, "alpha");
    skill(&target, "previous");
    assert!(files::replace_tree(&source, &target, None).is_err());
    assert!(
        fs::read_to_string(target.join("SKILL.md"))
            .unwrap()
            .contains("previous")
    );
}
#[cfg(unix)]
#[test]
fn state_files_are_owner_only() {
    use std::os::unix::fs::PermissionsExt;
    let f = Fixture::new();
    f.select(Scope::User, &[]);
    assert_eq!(
        fs::metadata(f.locations.state.join("skill-selections.toml"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
}
#[cfg(unix)]
#[test]
fn cleanup_unlinks_shared_symlinks_without_touching_external_content() {
    let f = Fixture::new();
    f.skill("alpha");
    let outside = f.repo.join("alpha");
    fs::create_dir_all(f.locations.shared(Scope::User)).unwrap();
    files::symlink(&outside, &f.shared(Scope::User, "alpha")).unwrap();
    f.select(Scope::User, &[]);
    f.manager().run(Action::Synchronize).unwrap();
    assert!(!f.shared(Scope::User, "alpha").exists());
    assert!(outside.join("SKILL.md").is_file());
}
