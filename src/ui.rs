use crate::{
    config::{Config, Locations, Scope},
    deployment, files,
    manager::{Action, Manager, Snapshot},
    repository::Skill,
    state::{self, Selections},
};
use anyhow::{Result, ensure};
use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use ratatui::{
    Frame,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    widgets::{Block, Borders, List, ListItem, ListState, Paragraph, Wrap},
};
use std::{fs, io::IsTerminal, sync::mpsc, thread, time::Duration};

const SERVICES: [&str; 4] = [
    "Browse by repository",
    "Browse installed skills",
    "Find",
    "Updates",
];
const ACCENT: Color = Color::Rgb(203, 166, 247);
const TEXT: Color = Color::Rgb(205, 214, 244);
const MUTED: Color = Color::Rgb(147, 153, 178);
const BASE: Color = Color::Rgb(30, 30, 46);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Focus {
    Services,
    Repos,
    Skills,
    Search,
    Settings,
}
#[derive(Clone)]
struct Row {
    repo: String,
    name: String,
    path: std::path::PathBuf,
    description: String,
}
pub struct App {
    locations: Locations,
    snapshot: Snapshot,
    scope: Scope,
    service: usize,
    focus: Focus,
    repo_index: usize,
    skill_index: usize,
    setting_index: usize,
    filter: String,
    preview_scroll: u16,
    busy: bool,
    status: String,
    output_scroll: u16,
}
impl App {
    fn new(locations: Locations) -> Result<Self> {
        let snapshot = Snapshot {
            config: Config::load(&locations.config)?,
            selections: Selections::load(&locations)?,
            disabled: state::load_disabled(&locations)?,
            inventory: Default::default(),
            errors: Vec::new(),
            changed: 0,
        };
        Ok(Self {
            locations,
            snapshot,
            scope: Scope::User,
            service: 0,
            focus: Focus::Services,
            repo_index: 0,
            skill_index: 0,
            setting_index: 0,
            filter: String::new(),
            preview_scroll: 0,
            busy: true,
            status: "Synchronizing skills in background...".into(),
            output_scroll: 0,
        })
    }
    fn rows(&self) -> Vec<Row> {
        let mut rows = Vec::new();
        if self.service == 1 {
            if let Ok(paths) = files::entries(&self.locations.shared(self.scope)) {
                for path in paths {
                    if !path.join("SKILL.md").is_file() {
                        continue;
                    }
                    let Ok(name) = files::name(&path) else {
                        continue;
                    };
                    let repo = self
                        .snapshot
                        .selections
                        .get(self.scope, &self.locations.project)
                        .and_then(|s| s.iter().find(|s| s.name == name))
                        .map(|s| s.repo.clone())
                        .unwrap_or_default();
                    rows.push(Row {
                        repo,
                        name,
                        path,
                        description: String::new(),
                    });
                }
            }
        } else {
            for (repo, skills) in &self.snapshot.inventory.repos {
                if self.service == 0
                    && self.snapshot.config.repos.get(self.repo_index) != Some(repo)
                {
                    continue;
                }
                for Skill {
                    name,
                    path,
                    description,
                } in skills
                {
                    rows.push(Row {
                        repo: repo.clone(),
                        name: name.clone(),
                        path: path.clone(),
                        description: description.clone(),
                    });
                }
            }
        }
        let filter = self.filter.to_lowercase();
        rows.retain(|r| {
            format!("{} {} {}", r.name, r.repo, r.description)
                .to_lowercase()
                .contains(&filter)
        });
        rows
    }
    fn selected(&self, row: &Row) -> bool {
        self.snapshot
            .selections
            .get(self.scope, &self.locations.project)
            .is_some_and(|values| {
                values
                    .iter()
                    .any(|s| s.repo == row.repo && s.name == row.name)
            })
    }
    fn focus_order(&self) -> Vec<Focus> {
        let mut order = vec![Focus::Services];
        if self.service == 0 {
            order.push(Focus::Repos);
        }
        order.push(Focus::Skills);
        if self.service != 3 {
            order.push(Focus::Search);
        }
        order.push(Focus::Settings);
        order
    }
    fn navigate(&mut self, backwards: bool) {
        let order = self.focus_order();
        let index = order.iter().position(|f| *f == self.focus).unwrap_or(0);
        let next = if backwards {
            (index + order.len() - 1) % order.len()
        } else {
            (index + 1) % order.len()
        };
        self.focus = order[next];
    }
    fn send(&mut self, sender: &mpsc::Sender<Action>, action: Action) {
        if self.busy {
            self.status = "Wait for the current operation to finish.".into();
            return;
        }
        if sender.send(action).is_ok() {
            self.busy = true;
            self.status = "Synchronizing skills in background...".into();
        } else {
            self.status = "Background worker stopped.".into();
        }
    }
    fn key(&mut self, key: KeyEvent, sender: &mpsc::Sender<Action>) -> bool {
        if key.kind == KeyEventKind::Release {
            return false;
        }
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
            return true;
        }
        match key.code {
            KeyCode::Tab | KeyCode::Right => {
                self.navigate(key.modifiers.contains(KeyModifiers::SHIFT));
                return false;
            }
            KeyCode::BackTab | KeyCode::Left => {
                self.navigate(true);
                return false;
            }
            KeyCode::Esc => {
                if !self.filter.is_empty() {
                    self.filter.clear();
                    self.skill_index = 0;
                    return false;
                }
                return true;
            }
            _ => {}
        }
        if self.focus == Focus::Search {
            match key.code {
                KeyCode::Char(c)
                    if !key
                        .modifiers
                        .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) =>
                {
                    self.filter.push(c);
                    self.skill_index = 0;
                }
                KeyCode::Backspace => {
                    self.filter.pop();
                    self.skill_index = 0;
                }
                KeyCode::Enter | KeyCode::Down => {
                    self.focus = Focus::Skills;
                }
                _ => {}
            }
            return false;
        }
        match key.code {
            KeyCode::Char('q') => return true,
            KeyCode::Char('g') => {
                self.scope = self.scope.toggle();
                self.skill_index = 0;
            }
            KeyCode::Char('/') if self.service != 3 => {
                self.focus = Focus::Search;
            }
            KeyCode::Char('r') => {
                let action = if self.service == 3 {
                    Action::Update(self.scope)
                } else {
                    Action::Synchronize
                };
                self.send(sender, action);
            }
            KeyCode::PageDown => {
                self.preview_scroll = self.preview_scroll.saturating_add(10);
                self.output_scroll = self.output_scroll.saturating_add(10);
            }
            KeyCode::PageUp => {
                self.preview_scroll = self.preview_scroll.saturating_sub(10);
                self.output_scroll = self.output_scroll.saturating_sub(10);
            }
            KeyCode::Up | KeyCode::Char('k') => self.move_index(false),
            KeyCode::Down | KeyCode::Char('j') => self.move_index(true),
            KeyCode::Enter | KeyCode::Char(' ') => match self.focus {
                Focus::Services => {
                    if self.service == 3 {
                        self.send(sender, Action::Update(self.scope));
                    }
                    self.focus = if self.service == 0 {
                        Focus::Repos
                    } else if self.service == 2 {
                        Focus::Search
                    } else {
                        Focus::Skills
                    };
                }
                Focus::Repos => {
                    self.focus = Focus::Skills;
                }
                Focus::Skills if self.service == 3 => self.send(sender, Action::Update(self.scope)),
                Focus::Skills => {
                    if let Some(row) = self.rows().get(self.skill_index).cloned() {
                        if row.repo.is_empty() {
                            self.status =
                                "This Skill Instance has no saved repository selection.".into();
                        } else {
                            self.send(
                                sender,
                                Action::Toggle {
                                    repo: row.repo,
                                    name: row.name,
                                    scope: self.scope,
                                },
                            );
                        }
                    }
                }
                Focus::Settings => {
                    if self.setting_index == 0 {
                        self.scope = self.scope.toggle();
                        self.skill_index = 0;
                    } else if let Some(agent) =
                        self.snapshot.config.agents.get(self.setting_index - 1)
                    {
                        self.send(sender, Action::ToggleAgent(agent.name.clone()));
                    }
                }
                _ => {}
            },
            _ => {}
        }
        false
    }
    fn move_index(&mut self, down: bool) {
        let row_count = self.rows().len();
        let (index, count) = match self.focus {
            Focus::Services => (&mut self.service, SERVICES.len()),
            Focus::Repos => (&mut self.repo_index, self.snapshot.config.repos.len()),
            Focus::Skills => (&mut self.skill_index, row_count),
            Focus::Settings => (
                &mut self.setting_index,
                self.snapshot.config.agents.len() + 1,
            ),
            _ => return,
        };
        *index = if down {
            (*index + 1).min(count.saturating_sub(1))
        } else {
            index.saturating_sub(1)
        };
        if matches!(self.focus, Focus::Services | Focus::Repos) {
            self.skill_index = 0;
            self.filter.clear();
        }
        self.preview_scroll = 0;
    }
    fn draw(&self, frame: &mut Frame) {
        let area = frame.area();
        frame.render_widget(
            Block::default().style(Style::default().bg(BASE).fg(TEXT)),
            area,
        );
        if area.width < 80 || area.height < 20 {
            frame.render_widget(
                Paragraph::new("Skills TUI: terminal must be at least 80 x 20.\nEsc: quit"),
                area,
            );
            return;
        }
        let outer = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(1),
                Constraint::Min(1),
                Constraint::Length(2),
                Constraint::Length(1),
            ])
            .split(area);
        frame.render_widget(
            Paragraph::new(format!(" Skills TUI — {}", self.scope.label()))
                .style(Style::default().fg(ACCENT).add_modifier(Modifier::BOLD)),
            outer[0],
        );
        let columns = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Length(25), Constraint::Min(1)])
            .split(outer[1]);
        let side = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Length(7), Constraint::Min(1)])
            .split(columns[0]);
        render_list(
            frame,
            side[0],
            "Services",
            SERVICES.iter().map(|s| s.to_string()).collect(),
            self.service,
            self.focus == Focus::Services,
        );
        let mut settings = vec![format!("Scope: {}", self.scope.label())];
        settings.extend(self.snapshot.config.agents.iter().map(|a| {
            format!(
                "[{}] {}",
                if self.snapshot.disabled.contains(&a.name) {
                    " "
                } else {
                    "x"
                },
                a.display
            )
        }));
        render_list(
            frame,
            side[1],
            "Settings",
            settings,
            self.setting_index,
            self.focus == Focus::Settings,
        );
        let content = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Min(1),
                Constraint::Length(if self.service == 3 { 0 } else { 3 }),
            ])
            .split(columns[1]);
        if self.service == 3 {
            let mut lines = vec![
                format!("{} Skill Instances changed.", self.snapshot.changed),
                String::new(),
            ];
            if self.snapshot.errors.is_empty() {
                lines.push("Selected skills are synchronized.".into());
            } else {
                lines.extend(self.snapshot.errors.clone());
            }
            lines.push(String::new());
            lines.push("New discoverable skills (not selected):".into());
            for (repo, skills) in &self.snapshot.inventory.repos {
                for skill in skills {
                    let selected = self
                        .snapshot
                        .selections
                        .get(self.scope, &self.locations.project)
                        .is_some_and(|s| s.iter().any(|s| s.repo == *repo && s.name == skill.name));
                    if !selected {
                        lines.push(format!("{repo}: {}", skill.name));
                    }
                }
            }
            frame.render_widget(
                Paragraph::new(lines.join("\n"))
                    .wrap(Wrap { trim: false })
                    .scroll((self.output_scroll, 0))
                    .block(panel(
                        "Updates — Enter or r: apply latest versions",
                        self.focus == Focus::Skills,
                    )),
                content[0],
            );
        } else {
            self.draw_skills(frame, content[0]);
            let search = if self.filter.is_empty() {
                "Type to filter skills...".into()
            } else {
                self.filter.clone()
            };
            frame.render_widget(
                Paragraph::new(search)
                    .block(panel("Filter — /: focus", self.focus == Focus::Search)),
                content[1],
            );
        }
        let message = if self.busy {
            "Synchronizing skills in background..."
        } else {
            &self.status
        };
        frame.render_widget(
            Paragraph::new(message)
                .style(Style::default().fg(if self.snapshot.errors.is_empty() {
                    MUTED
                } else {
                    Color::LightRed
                }))
                .wrap(Wrap { trim: false }),
            outer[2],
        );
        frame.render_widget(Paragraph::new(" Tab/←/→: panel  ↑/↓: move  Enter/Space: select  g: scope  /: filter  r: refresh  Esc: quit").style(Style::default().fg(MUTED)), outer[3]);
    }
    fn draw_skills(&self, frame: &mut Frame, area: Rect) {
        let parts = if self.service == 0 {
            Layout::default()
                .direction(Direction::Horizontal)
                .constraints([
                    Constraint::Percentage(25),
                    Constraint::Percentage(35),
                    Constraint::Percentage(40),
                ])
                .split(area)
        } else {
            Layout::default()
                .direction(Direction::Horizontal)
                .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
                .split(area)
        };
        let offset = usize::from(self.service == 0);
        if self.service == 0 {
            render_list(
                frame,
                parts[0],
                "Repositories",
                self.snapshot.config.repos.clone(),
                self.repo_index,
                self.focus == Focus::Repos,
            );
        }
        let rows = self.rows();
        let items = rows
            .iter()
            .map(|row| {
                let suffix = if self.service == 2 {
                    format!(" — {}", row.repo)
                } else {
                    String::new()
                };
                format!(
                    "[{}] {}{suffix}",
                    if self.selected(row) { "x" } else { " " },
                    row.name
                )
            })
            .collect();
        render_list(
            frame,
            parts[offset],
            if self.service == 1 {
                "Installed skills"
            } else {
                "Discoverable skills"
            },
            items,
            self.skill_index,
            self.focus == Focus::Skills,
        );
        let preview = if let Some(row) = rows.get(self.skill_index) {
            let visibility = self
                .snapshot
                .config
                .agents
                .iter()
                .filter(|a| {
                    deployment::visible(
                        a,
                        &self.snapshot.config,
                        &self.locations,
                        self.scope,
                        &row.name,
                    )
                })
                .map(|a| a.display.as_str())
                .collect::<Vec<_>>()
                .join(", ");
            let text = fs::read_to_string(row.path.join("SKILL.md"))
                .unwrap_or_else(|e| format!("Cannot read Skill definition: {e}"));
            format!(
                "{}\n{}\nAgent Visibility: {}\n\n{}",
                row.name,
                row.path.display(),
                if visibility.is_empty() {
                    "none"
                } else {
                    &visibility
                },
                text
            )
        } else if self.busy {
            "Reading repositories...".into()
        } else {
            "No skills match. Repository errors appear in Updates.".into()
        };
        frame.render_widget(
            Paragraph::new(preview)
                .wrap(Wrap { trim: false })
                .scroll((self.preview_scroll, 0))
                .block(panel("Skill preview — PgUp/PgDn", false)),
            parts[offset + 1],
        );
    }
}
fn panel(title: &str, focused: bool) -> Block<'_> {
    Block::default()
        .borders(Borders::ALL)
        .title(title)
        .border_style(Style::default().fg(if focused { ACCENT } else { MUTED }))
}
fn render_list(
    frame: &mut Frame,
    area: Rect,
    title: &str,
    items: Vec<String>,
    index: usize,
    focused: bool,
) {
    let count = items.len();
    let items = items.into_iter().map(ListItem::new).collect::<Vec<_>>();
    let mut state = ListState::default().with_selected(if count == 0 {
        None
    } else {
        Some(index.min(count - 1))
    });
    frame.render_stateful_widget(
        List::new(items)
            .block(panel(title, focused))
            .highlight_style(
                Style::default()
                    .bg(Color::Rgb(69, 71, 90))
                    .add_modifier(Modifier::BOLD),
            )
            .highlight_symbol(if focused { "> " } else { "  " }),
        area,
        &mut state,
    );
}
pub fn run(manager: Manager) -> Result<()> {
    ensure!(
        std::io::stdin().is_terminal() && std::io::stdout().is_terminal(),
        "Skills TUI requires an interactive terminal"
    );
    let mut app = App::new(manager.locations.clone())?;
    let (actions_tx, actions_rx) = mpsc::channel();
    let (results_tx, results_rx) = mpsc::channel::<Option<Result<Snapshot>>>();
    // The terminal is initialized before repository discovery starts.
    let mut terminal = ratatui::try_init()?;
    thread::spawn(move || {
        let mut manager = manager;
        let mut next = Action::Synchronize;
        loop {
            if results_tx.send(None).is_err() {
                break;
            }
            if results_tx.send(Some(manager.run(next))).is_err() {
                break;
            }
            next = match actions_rx.recv_timeout(Duration::from_secs(30)) {
                Ok(action) => action,
                Err(mpsc::RecvTimeoutError::Timeout) => Action::Synchronize,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            };
        }
    });
    let result = (|| -> Result<()> {
        loop {
            while let Ok(result) = results_rx.try_recv() {
                let Some(result) = result else {
                    app.busy = true;
                    continue;
                };
                app.busy = false;
                match result {
                    Ok(snapshot) => {
                        app.status = if snapshot.errors.is_empty() {
                            format!(
                                "Synchronized. {} Skill Instances changed.",
                                snapshot.changed
                            )
                        } else {
                            snapshot.errors.join(" | ")
                        };
                        app.snapshot = snapshot;
                        app.repo_index = app
                            .repo_index
                            .min(app.snapshot.config.repos.len().saturating_sub(1));
                        app.skill_index = app.skill_index.min(app.rows().len().saturating_sub(1));
                        app.setting_index = app.setting_index.min(app.snapshot.config.agents.len());
                    }
                    Err(error) => app.status = format!("{error:#}"),
                }
            }
            terminal.draw(|f| app.draw(f))?;
            if event::poll(Duration::from_millis(100))?
                && let Event::Key(key) = event::read()?
                && app.key(key, &actions_tx)
            {
                break;
            }
        }
        Ok(())
    })();
    ratatui::restore();
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::{Terminal, backend::TestBackend};
    fn app() -> (tempfile::TempDir, App) {
        let temp = tempfile::tempdir().unwrap();
        let locations = Locations::new(temp.path().join("home"), temp.path().join("project"));
        locations.initialize().unwrap();
        (temp, App::new(locations).unwrap())
    }
    #[test]
    fn narrow_terminal_shows_size_message() {
        let (_temp, app) = app();
        let mut terminal = Terminal::new(TestBackend::new(40, 10)).unwrap();
        terminal.draw(|f| app.draw(f)).unwrap();
        let text: String = terminal
            .backend()
            .buffer()
            .content
            .iter()
            .map(|c| c.symbol())
            .collect();
        assert!(text.contains("terminal must be"));
    }
    #[test]
    fn panels_render_at_minimum_size() {
        let (_temp, mut app) = app();
        for service in 0..4 {
            app.service = service;
            let mut terminal = Terminal::new(TestBackend::new(80, 20)).unwrap();
            terminal.draw(|f| app.draw(f)).unwrap();
            let text: String = terminal
                .backend()
                .buffer()
                .content
                .iter()
                .map(|c| c.symbol())
                .collect();
            assert!(text.contains("Skills TUI"));
            assert!(text.contains("Settings"));
        }
    }
    #[test]
    fn filter_input_does_not_trigger_commands() {
        let (_temp, mut app) = app();
        let (tx, rx) = mpsc::channel();
        app.focus = Focus::Search;
        for c in ['g', 'q', 'r'] {
            assert!(!app.key(KeyEvent::new(KeyCode::Char(c), KeyModifiers::NONE), &tx));
        }
        assert_eq!(app.filter, "gqr");
        assert_eq!(app.scope, Scope::User);
        assert!(rx.try_recv().is_err());
    }
}
