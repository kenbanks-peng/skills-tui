//! Native Find interaction. Network work never runs on the render thread.
use super::{GREEN, LAVENDER, MUTED, YELLOW, panel};
use crate::catalog::{Catalog, SearchSkill};
use anyhow::Result;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::{
    Frame,
    layout::{Constraint, Layout, Rect},
    style::Style,
    text::{Line, Span},
    widgets::{List, ListItem, ListState, Padding, Paragraph, Wrap},
};
use std::{sync::mpsc, thread};

#[derive(Default)]
pub(super) struct Find {
    pub query: String,
    pub results: Vec<SearchSkill>,
    pub index: usize,
    submitted: String,
    message: Option<String>,
    pending: Option<mpsc::Receiver<Result<Vec<SearchSkill>>>>,
}

impl Find {
    pub fn searching(&self) -> bool {
        self.pending.is_some()
    }

    pub fn submit(&mut self) {
        let query = self.query.trim().to_owned();
        if query.is_empty() {
            return;
        }
        self.submitted = query.clone();
        self.results.clear();
        self.index = 0;
        self.message = None;
        let (tx, rx) = mpsc::channel();
        self.pending = Some(rx);
        thread::spawn(move || {
            let base =
                std::env::var("SKILLS_API_URL").unwrap_or_else(|_| "https://skills.sh".into());
            let result = Catalog::new(&base).and_then(|catalog| catalog.search(&query));
            let _ = tx.send(result);
        });
    }

    pub fn cancel(&mut self) {
        // Dropping this receiver also prevents late replies from replacing a newer search.
        self.pending = None;
        self.message = Some("Search canceled. Press Enter to search again.".into());
    }

    pub fn poll(&mut self) {
        let Some(rx) = &self.pending else {
            return;
        };
        let result = match rx.try_recv() {
            Ok(result) => result,
            Err(mpsc::TryRecvError::Empty) => return,
            Err(mpsc::TryRecvError::Disconnected) => {
                Err(anyhow::anyhow!("Search worker stopped. Try again."))
            }
        };
        self.pending = None;
        match result {
            Ok(results) => self.results = results,
            Err(error) => {
                self.message = Some(format!("{error:#}. Press Enter in Search Query to retry."))
            }
        }
    }

    pub fn edit(&mut self, key: KeyEvent) {
        match key.code {
            KeyCode::Enter => self.submit(),
            KeyCode::Backspace => {
                self.query.pop();
            }
            KeyCode::Char(c)
                if !c.is_control()
                    && !key
                        .modifiers
                        .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT)
                    && self.query.chars().count() < 256 =>
            {
                self.query.push(c);
            }
            _ => {}
        }
    }

    pub fn move_index(&mut self, down: bool, step: usize) {
        self.index = if down {
            self.index
                .saturating_add(step)
                .min(self.results.len().saturating_sub(1))
        } else {
            self.index.saturating_sub(step)
        };
    }

    pub fn draw(
        &self,
        frame: &mut Frame,
        area: Rect,
        focus: super::Focus,
        installed: impl Fn(&SearchSkill) -> bool,
        scope: &str,
        busy: bool,
    ) {
        let query_focus = focus == super::Focus::Query;
        let result_focus = focus == super::Focus::Skills;
        let parts = Layout::vertical([Constraint::Length(5), Constraint::Min(1)]).split(area);
        let query_block =
            panel("Search Query · skills.sh", query_focus).padding(Padding::horizontal(1));
        let query_width = parts[0].width.saturating_sub(6) as usize;
        let query = self
            .query
            .chars()
            .skip(self.query.chars().count().saturating_sub(query_width))
            .collect::<String>();
        let query_text = vec![
            Line::from(vec![
                Span::styled("› ", Style::default().fg(MUTED)),
                Span::raw(query),
                Span::styled(
                    if query_focus { "▎" } else { "" },
                    Style::default().fg(LAVENDER),
                ),
            ]),
            Line::styled(
                "Enter: search catalog   Tab: results   Esc: back / cancel search",
                Style::default().fg(MUTED),
            ),
        ];
        frame.render_widget(Paragraph::new(query_text).block(query_block), parts[0]);
        let show_details = area.width >= 80;
        let columns = Layout::horizontal(if show_details {
            [Constraint::Percentage(58), Constraint::Percentage(42)]
        } else {
            [Constraint::Percentage(100), Constraint::Length(0)]
        })
        .spacing(u16::from(show_details))
        .split(parts[1]);
        let title = if self.searching() {
            "Results · searching…".into()
        } else if self.submitted.is_empty() {
            "Results".into()
        } else {
            format!("Results · {} for {}", self.results.len(), self.submitted)
        };
        let block = panel(&title, result_focus);
        let inner = block.inner(columns[0]);
        frame.render_widget(block, columns[0]);
        let message = if self.searching() {
            Some("Searching skills.sh… Esc cancels the search.")
        } else if let Some(message) = &self.message {
            Some(message.as_str())
        } else if self.submitted.is_empty() {
            Some("Search the public skill catalog. Type a query above and press Enter.")
        } else if self.results.is_empty() {
            Some("No skills found. Try a different query.")
        } else {
            None
        };
        if let Some(message) = message {
            frame.render_widget(
                Paragraph::new(message)
                    .style(Style::default().fg(MUTED))
                    .wrap(Wrap { trim: false }),
                inner,
            );
        } else {
            let items = self
                .results
                .iter()
                .map(|skill| {
                    ListItem::new(vec![
                        Line::from(vec![
                            Span::styled(&skill.name, Style::default().fg(YELLOW)),
                            Span::styled(
                                if installed(skill) {
                                    "  ✓ Selected"
                                } else {
                                    ""
                                },
                                Style::default().fg(GREEN),
                            ),
                        ]),
                        Line::styled(
                            format!(
                                "{} · {} installs",
                                skill.repository().unwrap_or("Unknown repository"),
                                skill.installs
                            ),
                            Style::default().fg(MUTED),
                        ),
                        Line::default(),
                    ])
                })
                .collect::<Vec<_>>();
            let mut state = ListState::default().with_selected(Some(self.index));
            frame.render_stateful_widget(
                List::new(items)
                    .highlight_style(Style::default().bg(super::Color::Rgb(69, 71, 90))),
                inner,
                &mut state,
            );
        }
        if !show_details {
            return;
        }
        let lines = if let Some(skill) = self.results.get(self.index) {
            let selected = installed(skill);
            vec![
                Line::styled(skill.name.clone(), Style::default().fg(YELLOW).bold()),
                Line::default(),
                Line::styled("Repository", Style::default().fg(LAVENDER)),
                Line::raw(
                    skill
                        .repository()
                        .unwrap_or("Unknown repository")
                        .to_owned(),
                ),
                Line::default(),
                Line::styled(
                    format!("{} installs", skill.installs),
                    Style::default().fg(GREEN),
                ),
                Line::default(),
                Line::raw(skill.url()),
                Line::default(),
                Line::styled(
                    format!("Install Scope: {scope}"),
                    Style::default().fg(LAVENDER),
                ),
                Line::default(),
                Line::raw(if selected {
                    "Already selected in this scope.".to_owned()
                } else if busy {
                    "Wait for synchronization to finish.".to_owned()
                } else {
                    "Enter: install the selected skill".to_owned()
                }),
                Line::default(),
                Line::styled(
                    "Installation adds this repository to your configuration. Only this skill is selected. Agent settings apply.",
                    Style::default().fg(MUTED),
                ),
            ]
        } else {
            vec![Line::styled(
                "Select a result to see its repository and installation details.",
                Style::default().fg(MUTED),
            )]
        };
        frame.render_widget(
            Paragraph::new(lines)
                .block(panel("Skill Details", false))
                .wrap(Wrap { trim: false }),
            columns[1],
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::{Terminal, backend::TestBackend};

    fn rendered(find: &Find) -> String {
        let mut terminal = Terminal::new(TestBackend::new(160, 35)).unwrap();
        terminal
            .draw(|frame| {
                find.draw(
                    frame,
                    frame.area(),
                    super::super::Focus::Query,
                    |_| false,
                    "Project Scope",
                    false,
                )
            })
            .unwrap();
        terminal
            .backend()
            .buffer()
            .content
            .iter()
            .map(|cell| cell.symbol())
            .collect()
    }

    #[test]
    fn shows_loading_results_and_network_failure_without_raw_command_output() {
        let (tx, rx) = mpsc::channel();
        let mut find = Find {
            submitted: "rust".into(),
            pending: Some(rx),
            ..Find::default()
        };
        assert!(rendered(&find).contains("Searching skills.sh"));
        tx.send(Ok(vec![SearchSkill {
            id: "org/repo/rust".into(),
            name: "rust".into(),
            source: "org/repo".into(),
            installs: 1234,
        }]))
        .unwrap();
        find.poll();
        let text = rendered(&find);
        assert!(text.contains("1234 installs"));
        assert!(text.contains("org/repo"));
        assert!(text.contains("Install Scope: Project Scope"));
        assert!(text.contains("Enter: install"));
        let (tx, rx) = mpsc::channel();
        find.pending = Some(rx);
        find.results.clear();
        tx.send(Err(anyhow::anyhow!("HTTP 429"))).unwrap();
        find.poll();
        let text = rendered(&find);
        assert!(text.contains("HTTP 429"));
        assert!(text.contains("retry"));
    }

    #[test]
    fn cancel_discards_late_replies_and_new_search_shows_empty_results() {
        let (tx, rx) = mpsc::channel();
        let mut find = Find {
            submitted: "rust".into(),
            pending: Some(rx),
            ..Find::default()
        };
        find.cancel();
        assert!(!find.searching());
        assert!(tx.send(Ok(Vec::new())).is_err());
        assert!(rendered(&find).contains("Search canceled"));
        let (tx, rx) = mpsc::channel();
        find.pending = Some(rx);
        find.message = None;
        tx.send(Ok(Vec::new())).unwrap();
        find.poll();
        assert!(rendered(&find).contains("No skills found"));
    }
}
