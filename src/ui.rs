mod find;

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
    layout::{Alignment, Constraint, Flex, Layout, Rect},
    style::{Color, Style},
    text::{Line, Span},
    widgets::{
        Block, BorderType, Borders, Cell, List, ListItem, ListState, Padding, Paragraph,
        Row as TableRow, Table, TableState, Wrap,
    },
};
use std::{fs, io::IsTerminal, sync::mpsc, thread, time::Duration};

const SERVICES: [&str; 3] = ["View by repo", "View by skill", "Find"];
const ACCENT: Color = Color::Rgb(203, 166, 247);
const TEXT: Color = Color::Rgb(205, 214, 244);
const MUTED: Color = Color::Rgb(127, 132, 156);
const BORDER: Color = Color::Rgb(88, 91, 112);
const LAVENDER: Color = Color::Rgb(180, 190, 254);
const GREEN: Color = Color::Rgb(166, 227, 161);
const YELLOW: Color = Color::Rgb(249, 226, 175);
const SAPPHIRE: Color = Color::Rgb(116, 199, 236);
const BASE: Color = Color::Rgb(30, 30, 46);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Focus {
    Services,
    Repos,
    Skills,
    Search,
    Settings,
    Query,
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
    refreshing: bool,
    status: String,
    find: find::Find,
    installing: Option<(String, Scope)>,
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
            refreshing: true,
            status: "Synchronizing skills in background...".into(),
            find: find::Find::default(),
            installing: None,
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
            if self.service == 1 {
                return r.name.to_lowercase().contains(&filter);
            }
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
        if self.service == 2 {
            order.push(Focus::Query);
        }
        order.push(Focus::Skills);
        if self.service < 2 {
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
        let installing = match &action {
            Action::Install { name, scope, .. } => Some((name.clone(), *scope)),
            _ => None,
        };
        let refreshing = matches!(action, Action::Refresh);
        if sender.send(action).is_ok() {
            self.refreshing = refreshing;
            self.installing = installing;
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
                if self.service == 2 && matches!(self.focus, Focus::Query | Focus::Skills) {
                    if self.find.searching() {
                        self.find.cancel();
                    } else {
                        self.focus = if self.focus == Focus::Skills {
                            Focus::Query
                        } else {
                            Focus::Services
                        };
                    }
                    return false;
                }
                if !self.filter.is_empty() {
                    self.filter.clear();
                    self.skill_index = 0;
                    return false;
                }
                return true;
            }
            _ => {}
        }
        if self.service == 2 && self.focus == Focus::Query {
            self.find.edit(key);
            return false;
        }
        if self.service == 2 && self.focus == Focus::Skills {
            match key.code {
                KeyCode::Up | KeyCode::Char('k') => self.find.move_index(false, 1),
                KeyCode::Down | KeyCode::Char('j') => self.find.move_index(true, 1),
                KeyCode::PageUp => self.find.move_index(false, 10),
                KeyCode::PageDown => self.find.move_index(true, 10),
                KeyCode::Enter => {
                    if let Some(skill) = self.find.results.get(self.find.index)
                        && let Some(repo) = skill.repository()
                    {
                        let already_selected = self
                            .snapshot
                            .selections
                            .get(self.scope, &self.locations.project)
                            .is_some_and(|values| {
                                values
                                    .iter()
                                    .any(|s| s.repo == repo && s.name == skill.name)
                            });
                        if !already_selected {
                            let action = Action::Install {
                                repo: repo.into(),
                                name: skill.name.clone(),
                                scope: self.scope,
                            };
                            self.send(sender, action);
                        }
                    }
                }
                KeyCode::Char('/') => self.focus = Focus::Query,
                KeyCode::Char('g') => self.scope = self.scope.toggle(),
                KeyCode::Char('r') => self.send(sender, Action::Refresh),
                KeyCode::Char('q') => return true,
                _ => {}
            }
            return false;
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
            KeyCode::Char('/') if self.service < 2 => {
                self.focus = Focus::Search;
            }
            KeyCode::Char('r') => self.send(sender, Action::Refresh),
            KeyCode::PageDown => {
                self.preview_scroll = self.preview_scroll.saturating_add(10);
            }
            KeyCode::PageUp => {
                self.preview_scroll = self.preview_scroll.saturating_sub(10);
            }
            KeyCode::Up | KeyCode::Char('k') => self.move_index(false),
            KeyCode::Down | KeyCode::Char('j') => self.move_index(true),
            KeyCode::Enter | KeyCode::Char(' ') => match self.focus {
                Focus::Services => {
                    self.focus = if self.service == 0 {
                        Focus::Repos
                    } else if self.service == 2 {
                        Focus::Query
                    } else {
                        Focus::Skills
                    };
                }
                Focus::Repos => {
                    self.focus = Focus::Skills;
                }
                Focus::Skills if self.service == 1 => {}
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
        let outer = Layout::vertical([Constraint::Min(1), Constraint::Length(6)]).split(area);
        let columns = Layout::horizontal([Constraint::Length(28), Constraint::Min(1)])
            .spacing(1)
            .split(outer[0]);
        let side = Layout::vertical([
            Constraint::Length(8),
            Constraint::Length(3),
            Constraint::Min(1),
        ])
        .spacing(0)
        .split(columns[0]);
        render_list(
            frame,
            side[0],
            "Services",
            SERVICES.iter().map(|s| s.to_string()).collect(),
            self.service,
            self.focus == Focus::Services,
        );
        self.draw_settings(frame, side[2]);
        if self.service == 1 {
            self.draw_installed(frame, columns[1]);
        } else if self.service == 2 {
            self.find.draw(
                frame,
                columns[1],
                self.focus,
                |skill| {
                    self.snapshot
                        .selections
                        .get(self.scope, &self.locations.project)
                        .is_some_and(|selections| {
                            selections.iter().any(|s| {
                                Some(s.repo.as_str()) == skill.repository() && s.name == skill.name
                            })
                        })
                },
                self.scope.label(),
                self.busy,
            );
        } else {
            self.draw_skills(frame, columns[1]);
        }
        draw_footer(frame, outer[1], self.service, self.focus);
        let footer = outer[1];
        let filter_disabled = self.service >= 2;
        let search = if filter_disabled {
            String::new()
        } else if self.filter.is_empty() {
            "› Type to filter...".into()
        } else {
            format!("› {}", self.filter)
        };
        frame.render_widget(
            Paragraph::new(search)
                .style(
                    Style::default().fg(if filter_disabled || self.filter.is_empty() {
                        MUTED
                    } else {
                        TEXT
                    }),
                )
                .block(
                    panel("Filter", !filter_disabled && self.focus == Focus::Search)
                        .padding(Padding::horizontal(1)),
                ),
            side[1],
        );
        let installing_message = self
            .installing
            .as_ref()
            .map(|(name, scope)| format!("Installing {name} in {}…", scope.label()));
        let message = if self.busy {
            installing_message.as_deref().unwrap_or(if self.refreshing {
                "Synchronizing and checking for updates..."
            } else {
                "Synchronizing skills in background..."
            })
        } else if self.status.starts_with("Synchronized.") {
            ""
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
            Rect::new(
                footer.x + 2,
                footer.y + 4,
                footer.width.saturating_sub(4),
                1,
            ),
        );
    }
    fn draw_settings(&self, frame: &mut Frame, area: Rect) {
        let block = panel("Settings", self.focus == Focus::Settings);
        let inner = block.inner(area);
        frame.render_widget(block, area);
        if inner.height == 0 {
            return;
        }
        let scope = if self.scope == Scope::User {
            "global"
        } else {
            "project"
        };
        let label = "▶ Scope:";
        let gap = inner
            .width
            .saturating_sub((label.chars().count() + scope.chars().count()) as u16)
            as usize;
        frame.render_widget(
            Paragraph::new(Line::from(vec![
                Span::styled(
                    if self.setting_index == 0 {
                        label
                    } else {
                        "  Scope:"
                    },
                    Style::default().fg(YELLOW),
                ),
                Span::raw(" ".repeat(gap)),
                Span::styled(
                    scope,
                    Style::default()
                        .fg(if self.scope == Scope::User {
                            GREEN
                        } else {
                            Color::Rgb(250, 179, 135)
                        })
                        .bold(),
                ),
            ]))
            .style(if self.setting_index == 0 {
                Style::default().bg(Color::Rgb(69, 71, 90))
            } else {
                Style::default()
            }),
            Rect::new(inner.x, inner.y, inner.width, 1),
        );
        let agents = self
            .snapshot
            .config
            .agents
            .iter()
            .map(|agent| {
                let checked = !self.snapshot.disabled.contains(&agent.name);
                ListItem::new(format!(
                    " [{}] {}",
                    if checked { "✓" } else { " " },
                    agent.display
                ))
                .style(Style::default().fg(if checked { GREEN } else { TEXT }))
            })
            .collect::<Vec<_>>();
        let mut state = ListState::default().with_selected(self.setting_index.checked_sub(1));
        frame.render_stateful_widget(
            List::new(agents)
                .highlight_style(Style::default().bg(Color::Rgb(69, 71, 90)).fg(YELLOW)),
            Rect::new(
                inner.x,
                inner.y + 2,
                inner.width,
                inner.height.saturating_sub(2),
            ),
            &mut state,
        );
    }
    fn draw_installed(&self, frame: &mut Frame, area: Rect) {
        let block = panel("Installed", self.focus == Focus::Skills);
        let rows = self.rows();
        if rows.is_empty() {
            frame.render_widget(
                Paragraph::new(if self.filter.is_empty() {
                    "No skills installed"
                } else {
                    "No skills match filter"
                })
                .style(Style::default().fg(MUTED))
                .block(block),
                area,
            );
            return;
        }
        let agents = self
            .snapshot
            .config
            .agents
            .iter()
            .filter(|agent| !self.snapshot.disabled.contains(&agent.name))
            .collect::<Vec<_>>();
        let mut header = vec![Cell::from("Skill")];
        header.extend(agents.iter().map(|agent| {
            Cell::from(Line::from(agent.display.clone()).alignment(Alignment::Center))
        }));
        let name_width = rows
            .iter()
            .map(|row| row.name.chars().count())
            .max()
            .unwrap_or(0)
            .max(12);
        let mut widths = vec![Constraint::Length(
            name_width.saturating_add(2).min(u16::MAX as usize) as u16,
        )];
        widths.extend(agents.iter().map(|agent| {
            Constraint::Length(
                (agent.display.chars().count().max(6) + 2).min(u16::MAX as usize) as u16,
            )
        }));
        let items = rows
            .iter()
            .map(|row| {
                let mut cells = vec![Cell::from(row.name.clone())];
                cells.extend(agents.iter().map(|agent| {
                    let visible = deployment::visible(
                        agent,
                        &self.snapshot.config,
                        &self.locations,
                        self.scope,
                        &row.name,
                    );
                    Cell::from(
                        Line::from(if visible { "✓" } else { "·" }).alignment(Alignment::Center),
                    )
                    .style(Style::default().fg(if visible {
                        GREEN
                    } else {
                        MUTED
                    }))
                }));
                TableRow::new(cells)
            })
            .collect::<Vec<_>>();
        let mut state = TableState::default().with_selected(Some(self.skill_index));
        frame.render_stateful_widget(
            Table::new(items, widths)
                .flex(Flex::Start)
                .header(
                    TableRow::new(header)
                        .style(Style::default().fg(LAVENDER).bold())
                        .bottom_margin(1),
                )
                .row_highlight_style(if self.focus == Focus::Skills {
                    Style::default().bg(Color::Rgb(69, 71, 90)).fg(YELLOW)
                } else {
                    Style::default()
                })
                .block(block),
            area,
            &mut state,
        );
    }
    fn draw_skills(&self, frame: &mut Frame, area: Rect) {
        let rows = self.rows();
        let widths = repository_widths(
            area.width,
            &self.snapshot.config.repos,
            &self
                .snapshot
                .inventory
                .repos
                .values()
                .flatten()
                .map(|skill| skill.name.clone())
                .collect::<Vec<_>>(),
        );
        let show_preview = self.service != 0 || widths[2] > 0;
        let parts = if self.service == 0 {
            Layout::horizontal(
                widths[..if show_preview { 3 } else { 2 }]
                    .iter()
                    .copied()
                    .map(Constraint::Length),
            )
            .spacing(1)
            .split(area)
        } else {
            Layout::horizontal([Constraint::Percentage(50), Constraint::Percentage(50)])
                .spacing(1)
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
                    if self.selected(row) { "✓" } else { " " },
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
                "Skills (Space to select)"
            },
            items,
            self.skill_index,
            self.focus == Focus::Skills,
        );
        if !show_preview {
            return;
        }
        let preview = if let Some(row) = rows.get(self.skill_index) {
            let text = fs::read_to_string(row.path.join("SKILL.md"));
            preview_lines(
                &row.name,
                &row.path.join("SKILL.md").display().to_string(),
                text.as_deref().ok(),
            )
        } else {
            vec![Line::styled(
                if self.busy {
                    "Reading repositories..."
                } else {
                    "Select a skill to preview"
                },
                Style::default().fg(MUTED),
            )]
        };
        frame.render_widget(
            Paragraph::new(preview)
                .wrap(Wrap { trim: false })
                .scroll((self.preview_scroll, 0))
                .block(panel("Preview", false)),
            parts[offset + 1],
        );
    }
}
fn panel(title: &str, focused: bool) -> Block<'_> {
    Block::default()
        .borders(Borders::ALL)
        .title(format!(" {title} "))
        .title_style(Style::default().fg(if focused { LAVENDER } else { BORDER }))
        .border_type(if focused {
            BorderType::Double
        } else {
            BorderType::Rounded
        })
        .padding(Padding::new(1, 1, 1, 1))
        .border_style(Style::default().fg(if focused { LAVENDER } else { BORDER }))
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
    let cursor = title == "Services" || title == "Repositories";
    let items = items
        .into_iter()
        .enumerate()
        .map(|(i, item)| {
            let checked = item.starts_with("[✓]");
            let prefix = if cursor && i == index {
                "▶ "
            } else if cursor {
                "  "
            } else {
                " "
            };
            ListItem::new(format!("{prefix}{item}")).style(Style::default().fg(if checked {
                GREEN
            } else {
                TEXT
            }))
        })
        .collect::<Vec<_>>();
    let mut state = ListState::default().with_selected(if count == 0 {
        None
    } else {
        Some(index.min(count - 1))
    });
    frame.render_stateful_widget(
        List::new(items)
            .block(panel(title, focused))
            .highlight_style(Style::default().bg(Color::Rgb(69, 71, 90)).fg(YELLOW)),
        area,
        &mut state,
    );
}
// Use the same preferred widths and surplus distribution as the TypeScript UI.
fn repository_widths(width: u16, repos: &[String], skills: &[String]) -> [u16; 3] {
    let longest = |values: &[String]| {
        values
            .iter()
            .map(|v| v.chars().count())
            .max()
            .unwrap_or(0)
            .min(u16::MAX as usize - 9) as u16
    };
    let preferred = [14.max(longest(repos) + 6), 36.max(longest(skills) + 9), 36];
    let available = width.saturating_sub(2);
    let total: u32 = preferred.iter().map(|v| u32::from(*v)).sum();
    if u32::from(available) >= total {
        let surplus = available - total as u16;
        return std::array::from_fn(|i| {
            preferred[i] + surplus / 3 + u16::from((i as u16) < surplus % 3)
        });
    }
    let available = width.saturating_sub(1);
    let minimum = 14 + 36;
    let remaining = available.saturating_sub(minimum);
    let deficits = [preferred[0] - 14, preferred[1] - 36];
    let total = u32::from(deficits[0]) + u32::from(deficits[1]);
    let extra = (u32::from(remaining) * u32::from(deficits[0]) + total / 2)
        .checked_div(total)
        .unwrap_or(0)
        .min(u32::from(deficits[0])) as u16;
    [14 + extra, available.saturating_sub(14 + extra), 0]
}
fn truncate(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        text.into()
    } else {
        format!(
            "{}...",
            text.chars()
                .take(limit.saturating_sub(3))
                .collect::<String>()
        )
    }
}
fn preview_lines(name: &str, path: &str, content: Option<&str>) -> Vec<Line<'static>> {
    let mut lines = vec![
        Line::styled(truncate(name, 34), Style::default().fg(YELLOW).bold()),
        Line::default(),
    ];
    let Some(content) = content else {
        lines.push(Line::styled(
            "No SKILL.md preview available",
            Style::default().fg(MUTED),
        ));
        return lines;
    };
    lines.push(Line::styled(truncate(path, 34), Style::default().fg(MUTED)));
    lines.push(Line::default());
    let mut summary = Vec::new();
    let mut past_title = false;
    for line in content.lines().map(str::trim) {
        if line.is_empty() {
            if !summary.is_empty() {
                break;
            }
            continue;
        }
        if !past_title && line.starts_with('#') {
            past_title = true;
            continue;
        }
        if line.starts_with("```") {
            continue;
        }
        summary.push(line);
    }
    if !summary.is_empty() {
        lines.push(Line::styled("Summary", Style::default().fg(LAVENDER)));
        lines.push(Line::raw(truncate(&summary.join(" "), 180)));
    }
    let mut section = content.lines().skip_while(|line| {
        let line = line.trim().to_lowercase();
        !(line.starts_with('#') && line.contains("when to use"))
    });
    section.next();
    let snippet = section
        .map(str::trim)
        .take_while(|line| !line.starts_with('#'))
        .filter(|line| !line.is_empty())
        .take(3)
        .map(|line| line.strip_prefix('-').map(str::trim_start).unwrap_or(line))
        .collect::<Vec<_>>()
        .join(" ");
    if !snippet.is_empty() {
        lines.push(Line::default());
        lines.push(Line::styled("When to use", Style::default().fg(LAVENDER)));
        lines.push(Line::styled(
            truncate(&snippet, 180),
            Style::default().fg(Color::Rgb(186, 194, 222)),
        ));
    }
    lines
}
fn draw_footer(frame: &mut Frame, area: Rect, service: usize, focus: Focus) {
    let block = Block::bordered().border_style(Style::default().fg(Color::Rgb(69, 71, 90)));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    // Match OpenTUI's tiny font glyphs and one-column letter spacing.
    let logo = ["█▀▀ █▄▀ █ █   █   █▀▀", "▄▄█ █ █ █ █▄▄ █▄▄ ▄▄█"];
    for (i, line) in logo.iter().enumerate() {
        frame.render_widget(
            Paragraph::new(*line).style(Style::default().fg(ACCENT)),
            Rect::new(
                inner.x + 1,
                inner.y + i as u16,
                24.min(inner.width.saturating_sub(1)),
                1,
            ),
        );
    }
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled("   ⎼⎼⊰", Style::default().fg(GREEN)),
            Span::styled("⦅@", Style::default().fg(Color::Rgb(243, 139, 168))),
        ])),
        Rect::new(inner.x + 1, inner.y + 2, inner.width.saturating_sub(1), 1),
    );
    let mut spans = Vec::new();
    let actions = match service {
        1 => [
            ("Navigate: ", "Tab/Arrows"),
            ("Filter: ", "/"),
            ("Scope: ", "g"),
            ("Quit: ", "Esc"),
        ],
        2 => [
            ("Navigate: ", "Tab/Arrows"),
            (
                if focus == Focus::Query {
                    "Search: "
                } else {
                    "Install: "
                },
                "Enter",
            ),
            ("Scope: ", "g (results)"),
            ("Back: ", "Esc"),
        ],
        _ => [
            ("Navigate: ", "Tab/Arrows"),
            ("Select: ", "Enter"),
            ("Toggle: ", "Space"),
            ("Quit: ", "Esc"),
        ],
    };
    for (i, (label, key)) in actions.iter().enumerate() {
        if i > 0 {
            spans.push(Span::raw("   "));
        }
        spans.push(Span::styled(*label, Style::default().fg(SAPPHIRE)));
        spans.push(Span::styled(*key, Style::default().fg(MUTED)));
    }
    let help = Rect::new(
        inner.x + 26,
        inner.y + inner.height / 2,
        inner.width.saturating_sub(27),
        1,
    );
    frame.render_widget(
        Paragraph::new(Line::from(spans)).alignment(Alignment::Right),
        help,
    );
}
// The first refresh runs only after terminal initialization. Afterward the
// worker sleeps until an explicit User action; there is no periodic timer.
fn background_worker(
    mut manager: Manager,
    actions: mpsc::Receiver<Action>,
    results: mpsc::Sender<Option<Result<Snapshot>>>,
) {
    let mut next = Action::Refresh;
    loop {
        if results.send(None).is_err() {
            break;
        }
        if results.send(Some(manager.run(next))).is_err() {
            break;
        }
        next = match actions.recv() {
            Ok(action) => action,
            Err(_) => break,
        };
    }
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
    thread::spawn(move || background_worker(manager, actions_rx, results_tx));
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
                            if let Some((name, scope)) = app.installing.take() {
                                format!("Installed {name} in {}.", scope.label())
                            } else if app.refreshing {
                                if snapshot.changed == 0 {
                                    "Skills are up to date.".into()
                                } else {
                                    format!(
                                        "Updated and synchronized. {} Skill Instances changed.",
                                        snapshot.changed
                                    )
                                }
                            } else {
                                format!(
                                    "Synchronized. {} Skill Instances changed.",
                                    snapshot.changed
                                )
                            }
                        } else {
                            app.installing = None;
                            snapshot.errors.join(" | ")
                        };
                        app.snapshot = snapshot;
                        app.repo_index = app
                            .repo_index
                            .min(app.snapshot.config.repos.len().saturating_sub(1));
                        app.skill_index = app.skill_index.min(app.rows().len().saturating_sub(1));
                        app.setting_index = app.setting_index.min(app.snapshot.config.agents.len());
                    }
                    Err(error) => {
                        app.installing = None;
                        app.status = format!("{error:#}");
                    }
                }
                app.refreshing = false;
            }
            app.find.poll();
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
        for service in 0..SERVICES.len() {
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
            assert!(text.contains("Services"));
            assert!(text.contains("Settings"));
        }
    }
    #[test]
    fn reference_layout_has_compact_labels_and_footer() {
        let (_temp, mut app) = app();
        app.busy = false;
        app.status = "Synchronized. 0 Skill Instances changed.".into();
        let mut terminal = Terminal::new(TestBackend::new(206, 46)).unwrap();
        terminal.draw(|f| app.draw(f)).unwrap();
        let buffer = terminal.backend().buffer();
        let text: String = buffer.content.iter().map(|c| c.symbol()).collect();
        for label in [
            "View by repo",
            "View by skill",
            "Skills (Space to select)",
            "Preview",
            "Navigate:",
            "global",
        ] {
            assert!(text.contains(label), "missing {label}");
        }
        assert!(!text.contains("Synchronized."));
        assert!(!text.contains("Updates"));
        assert_eq!(buffer[(0, 0)].symbol(), "╔");
        assert_eq!(buffer[(29, 0)].symbol(), "╭");
    }

    #[test]
    fn preview_matches_reference_snippets() {
        let content = "# Example\n\nA short summary.\n\n## When to use\n- First case\n- Second case\n- Third case\n- Hidden fourth case\n## Details\nHidden full document";
        let lines = preview_lines("example", "/skills/example/SKILL.md", Some(content));
        let text = lines
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("\n");
        assert!(text.contains("Summary\nA short summary."));
        assert!(text.contains("When to use\nFirst case Second case Third case"));
        assert!(!text.contains("Hidden"));
        assert!(!text.contains("Agent Visibility"));
        assert_eq!(truncate("é".repeat(181).as_str(), 180).chars().count(), 180);
        assert!(
            preview_lines("example", "path", None)
                .iter()
                .any(|line| line.to_string().contains("No SKILL.md"))
        );
    }

    #[test]
    fn repository_panels_fit_and_hide_preview_when_narrow() {
        let repos = vec!["kenbanks-peng/skills".into()];
        let skills = vec!["html-custom-editing-interfaces".into()];
        let widths = repository_widths(176, &repos, &skills);
        assert_eq!(widths.iter().sum::<u16>() + 2, 176);
        assert!(widths[2] >= 36);
        let widths = repository_widths(50, &repos, &skills);
        assert_eq!(widths[2], 0);
        assert_eq!(widths[0] + widths[1] + 1, 50);
    }

    #[test]
    fn filter_stays_between_services_and_settings_without_resizing_content() {
        let (_temp, mut app) = app();
        for busy in [false, true] {
            app.busy = busy;
            app.status = "Synchronized. 0 Skill Instances changed.".into();
            let mut terminal = Terminal::new(TestBackend::new(206, 46)).unwrap();
            terminal.draw(|f| app.draw(f)).unwrap();
            let buffer = terminal.backend().buffer();
            let footer_y = 40;
            // The sidebar and all content panels end immediately above the footer.
            for x in 0..206 {
                if buffer[(x, 0)].symbol() == "╭" || x == 0 {
                    assert_eq!(buffer[(x, footer_y - 1)].symbol(), "╰", "column at {x}");
                }
            }
            assert_eq!(buffer[(0, footer_y)].symbol(), "┌");
            assert_eq!(buffer[(29, footer_y - 1)].symbol(), "╰");
            let row = |y| {
                (0..206)
                    .map(|x| buffer[(x, y)].symbol())
                    .collect::<String>()
            };
            assert!(row(8).contains("Filter"));
            assert!(row(11).contains("Settings"));
            assert!(row(9).contains("Type to filter..."));
            assert!(!row(footer_y + 4).contains("Filter"));
            assert_eq!(row(footer_y + 4).contains("Synchronizing"), busy);
        }
    }

    #[test]
    fn find_keeps_filter_visible_but_disabled() {
        let (_temp, mut app) = app();
        app.service = 2;
        app.busy = false;
        let mut terminal = Terminal::new(TestBackend::new(206, 46)).unwrap();
        terminal.draw(|f| app.draw(f)).unwrap();
        let buffer = terminal.backend().buffer();
        let row = |y| (0..28).map(|x| buffer[(x, y)].symbol()).collect::<String>();
        assert!(row(8).contains("Filter"));
        assert!(row(9).chars().skip(1).take(26).all(|c| c == ' '));
        assert!(row(11).contains("Settings"));
        assert_eq!(buffer[(2, 9)].fg, MUTED);
        assert!(!app.focus_order().contains(&Focus::Search));
        let (tx, _rx) = mpsc::channel();
        app.key(KeyEvent::new(KeyCode::Char('/'), KeyModifiers::NONE), &tx);
        assert_ne!(app.focus, Focus::Search);
    }

    #[test]
    fn repository_width_is_stable_across_selection_and_filtering() {
        let (_temp, mut app) = app();
        app.snapshot.config.repos = vec!["one/repo".into(), "two/repo".into()];
        for (repo, name) in [
            ("one/repo", "short"),
            (
                "two/repo",
                "a-much-longer-skill-name-that-changes-the-layout",
            ),
        ] {
            app.snapshot.inventory.repos.insert(
                repo.into(),
                vec![Skill {
                    name: name.into(),
                    path: app.locations.cache.join(name),
                    description: String::new(),
                }],
            );
        }
        let mut expected = None;
        for (index, filter) in [(0, ""), (1, ""), (1, "no matches")] {
            app.repo_index = index;
            app.filter = filter.into();
            let mut terminal = Terminal::new(TestBackend::new(206, 46)).unwrap();
            terminal.draw(|f| app.draw(f)).unwrap();
            let buffer = terminal.backend().buffer();
            let borders = (29..206)
                .filter(|x| buffer[(*x, 0)].symbol() == "╭")
                .collect::<Vec<_>>();
            if let Some(expected) = &expected {
                assert_eq!(&borders, expected);
            } else {
                expected = Some(borders);
            }
        }
    }

    #[test]
    fn footer_logo_matches_typescript_tiny_font() {
        let (_temp, app) = app();
        let mut terminal = Terminal::new(TestBackend::new(206, 46)).unwrap();
        terminal.draw(|f| app.draw(f)).unwrap();
        let buffer = terminal.backend().buffer();
        for (y, expected) in [(41, "█▀▀ █▄▀ █ █   █   █▀▀"), (42, "▄▄█ █ █ █ █▄▄ █▄▄ ▄▄█")]
        {
            let actual = (2..23).map(|x| buffer[(x, y)].symbol()).collect::<String>();
            assert_eq!(actual, expected);
        }
    }

    #[test]
    fn installed_view_is_a_read_only_agent_visibility_table() {
        let (_temp, mut app) = app();
        app.service = 1;
        app.focus = Focus::Skills;
        let path = app.locations.shared(Scope::User).join("example");
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("SKILL.md"), "# Example").unwrap();
        let mut terminal = Terminal::new(TestBackend::new(206, 46)).unwrap();
        terminal.draw(|f| app.draw(f)).unwrap();
        let buffer = terminal.backend().buffer();
        let text: String = (0..40)
            .flat_map(|y| (29..206).map(move |x| buffer[(x, y)].symbol()))
            .collect();
        assert!(text.contains("Installed"));
        assert!(text.contains("Skill"));
        assert!(text.contains("Claude Code"));
        let header = (29..206)
            .map(|x| buffer[(x, 2)].symbol())
            .collect::<String>();
        assert!(
            header.find("Claude Code").unwrap() - header.find("Skill").unwrap() < 25,
            "Agent columns must stay beside the skill name: {header}"
        );
        assert!(text.contains("example"));
        assert!(text.contains("✓"));
        assert!(!text.contains("Preview"));
        let (tx, rx) = mpsc::channel();
        for key in [KeyCode::Enter, KeyCode::Char(' ')] {
            app.key(KeyEvent::new(key, KeyModifiers::NONE), &tx);
        }
        assert!(rx.try_recv().is_err());
        assert!(path.join("SKILL.md").is_file());
    }

    #[test]
    fn find_query_captures_command_keys_and_result_installs_in_selected_scope() {
        let (_temp, mut app) = app();
        app.service = 2;
        app.focus = Focus::Query;
        app.busy = false;
        let (tx, rx) = mpsc::channel();
        for c in "g q r".chars() {
            assert!(!app.key(KeyEvent::new(KeyCode::Char(c), KeyModifiers::NONE), &tx));
        }
        assert_eq!(app.find.query, "g q r");
        assert_eq!(app.scope, Scope::User);
        assert!(rx.try_recv().is_err());
        app.scope = Scope::Project;
        app.focus = Focus::Skills;
        app.find.results = vec![crate::catalog::SearchSkill {
            id: "owner/repo/example".into(),
            name: "example".into(),
            source: "owner/repo".into(),
            installs: 42,
        }];
        app.key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE), &tx);
        assert!(
            matches!(rx.try_recv().unwrap(), Action::Install { repo, name, scope: Scope::Project } if repo == "owner/repo" && name == "example")
        );
        app.busy = false;
        app.snapshot
            .selections
            .set(
                Scope::Project,
                &app.locations.project,
                vec![crate::state::Selection {
                    repo: "owner/repo".into(),
                    name: "example".into(),
                }],
            )
            .unwrap();
        app.key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE), &tx);
        assert!(rx.try_recv().is_err());
        app.key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE), &tx);
        assert_eq!(app.focus, Focus::Query);
        assert!(!app.focus_order().contains(&Focus::Search));
    }

    #[test]
    fn worker_refreshes_once_at_startup_then_waits_for_explicit_actions() {
        let (_temp, app) = app();
        let repo = app.locations.cache.join("fixture");
        fs::create_dir_all(repo.join("example")).unwrap();
        fs::write(repo.join("example/SKILL.md"), "# New content").unwrap();
        let repo_url = url::Url::from_directory_path(&repo).unwrap().to_string();
        fs::write(
            &app.locations.config,
            format!("repos = [{}]\n", toml::Value::String(repo_url.clone())),
        )
        .unwrap();
        let installed = app.locations.shared(Scope::User).join("example");
        fs::create_dir_all(&installed).unwrap();
        fs::write(installed.join("SKILL.md"), "# Old content").unwrap();
        let mut selections = Selections::default();
        selections
            .set(
                Scope::User,
                &app.locations.project,
                vec![crate::state::Selection {
                    repo: repo_url,
                    name: "example".into(),
                }],
            )
            .unwrap();
        selections.save(&app.locations).unwrap();
        let manager = Manager::open(app.locations).unwrap();
        let (actions_tx, actions_rx) = mpsc::channel();
        let (results_tx, results_rx) = mpsc::channel();
        let worker = thread::spawn(move || background_worker(manager, actions_rx, results_tx));
        assert!(
            results_rx
                .recv_timeout(Duration::from_secs(5))
                .unwrap()
                .is_none()
        );
        let snapshot = results_rx
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(snapshot.changed, 1);
        assert_eq!(
            fs::read_to_string(installed.join("SKILL.md")).unwrap(),
            "# New content"
        );
        assert!(matches!(
            results_rx.try_recv(),
            Err(mpsc::TryRecvError::Empty)
        ));
        actions_tx.send(Action::Refresh).unwrap();
        assert!(
            results_rx
                .recv_timeout(Duration::from_secs(5))
                .unwrap()
                .is_none()
        );
        assert_eq!(
            results_rx
                .recv_timeout(Duration::from_secs(5))
                .unwrap()
                .unwrap()
                .unwrap()
                .changed,
            0
        );
        drop(actions_tx);
        worker.join().unwrap();
        assert!(matches!(
            results_rx.try_recv(),
            Err(mpsc::TryRecvError::Disconnected)
        ));
    }

    #[test]
    fn manual_refresh_uses_the_combined_operation() {
        let (_temp, mut app) = app();
        app.busy = false;
        let (tx, rx) = mpsc::channel();
        app.key(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::NONE), &tx);
        assert!(matches!(rx.try_recv().unwrap(), Action::Refresh));
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
