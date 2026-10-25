use anyhow::{Result, bail};
use skills_tui::{
    config::Locations,
    manager::{Action, Manager},
    ui,
};

fn main() -> Result<()> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    match args.as_slice() {
        [arg] if arg == "--help" || arg == "-h" => {
            println!(
                "Skills TUI\n\nUsage: skills-tui [--sync | --help | --version]\n\n--sync     Synchronize both scopes without opening the TUI\n--version  Print the version\n\nKeys: Tab/arrows, Enter/Space, g: scope, /: filter, r: refresh, Esc: quit"
            );
            return Ok(());
        }
        [arg] if arg == "--version" || arg == "-V" => {
            println!("skills-tui {}", env!("CARGO_PKG_VERSION"));
            return Ok(());
        }
        [] => {}
        [arg] if arg == "--sync" => {
            let mut manager = Manager::open(Locations::detect()?)?;
            let result = manager.run(Action::Synchronize)?;
            println!("{} Skill Instances changed.", result.changed);
            if !result.errors.is_empty() {
                bail!("{}", result.errors.join("\n"));
            }
            return Ok(());
        }
        _ => bail!("Unknown argument. Use --help."),
    }
    ui::run(Manager::open(Locations::detect()?)?)
}
