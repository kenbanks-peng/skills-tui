use crate::{
    config::{Config, Locations, Scope},
    files,
    manager::{Action, Manager, Snapshot},
    repository::Skill,
    state::{self, Selections},
};
use anyhow::{Result, ensure};
use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use ratatui::{
    Frame,
    layout::{Alignment, Constraint, Direction, Layout, Rect},
    style::{Color, Style},
    text::{Line, Span},
    widgets::{Block, BorderType, Borders, List, ListItem, ListState, Padding, Paragraph, Wrap},
};
use std::{fs, io::IsTerminal, sync::mpsc, thread, time::Duration};

const SERVICES: [&str; 4] = ["View by repo", "View by skill", "Find", "Updates"];
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
        let notification = self.busy
            || !self.snapshot.errors.is_empty()
            || (!self.status.is_empty() && !self.status.starts_with("Synchronized."));
        let outer = Layout::vertical([
            Constraint::Length(1),
            Constraint::Min(1),
            Constraint::Length(u16::from(notification)),
            Constraint::Length(5),
        ])
        .split(area);
        let body = outer[1];
        let columns = Layout::horizontal([Constraint::Length(28), Constraint::Min(1)])
            .spacing(1)
            .split(Rect {
                height: body.height.saturating_sub(2),
                ..body
            });
        let side = Layout::vertical([Constraint::Length(8), Constraint::Min(1)])
            .spacing(1)
            .split(columns[0]);
        render_list(
            frame,
            side[0],
            "Services",
            SERVICES.iter().map(|s| s.to_string()).collect(),
            self.service,
            self.focus == Focus::Services,
        );
        let description = [
            "Browse and install",
            "Manage installed skills",
            "Find skills",
            "Check for updates",
        ][self.service];
        frame.render_widget(
            Paragraph::new(description)
                .style(Style::default().fg(Color::Rgb(166, 173, 200)).italic()),
            Rect::new(
                side[0].x + 2,
                side[0].bottom() - 1,
                side[0].width.saturating_sub(3),
                1,
            ),
        );
        self.draw_settings(frame, side[1]);
        let content = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Min(1),
                Constraint::Length(if self.service == 3 { 0 } else { 3 }),
            ])
            .spacing(1)
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
                "› Type to filter skills...".into()
            } else {
                format!("› {}", self.filter)
            };
            frame.render_widget(
                Paragraph::new(search)
                    .style(Style::default().fg(if self.filter.is_empty() { MUTED } else { TEXT }))
                    .block(
                        panel("Filter", self.focus == Focus::Search)
                            .padding(Padding::horizontal(1)),
                    ),
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
        draw_footer(frame, outer[3]);
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
    fn draw_skills(&self, frame: &mut Frame, area: Rect) {
        let rows = self.rows();
        let widths = repository_widths(
            area.width,
            &self.snapshot.config.repos,
            &rows.iter().map(|r| r.name.clone()).collect::<Vec<_>>(),
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
fn draw_footer(frame: &mut Frame, area: Rect) {
    let block = Block::bordered().border_style(Style::default().fg(Color::Rgb(69, 71, 90)));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    let logo = ["█▀▀ █ █ ▀█▀ █   █   █▀▀", "▄██ █▀▄ ▄█▄ █▄▄ █▄▄ ▄██"];
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
    for (i, (label, key)) in [
        ("Navigate: ", "Tab/Arrows"),
        ("Select: ", "Enter"),
        ("Toggle: ", "Space"),
        ("Quit: ", "Esc"),
    ]
    .iter()
    .enumerate()
    {
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
            "Browse and install",
        ] {
            assert!(text.contains(label), "missing {label}");
        }
        assert!(!text.contains("Synchronized."));
        assert_eq!(buffer[(0, 1)].symbol(), "╔");
        assert_eq!(buffer[(29, 1)].symbol(), "╭");
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
