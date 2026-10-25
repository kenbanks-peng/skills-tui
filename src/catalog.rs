//! Search the skills.sh catalog without a JavaScript runtime.
use anyhow::{Context, Result, ensure};
use reqwest::blocking::Client;
use serde::Deserialize;
use std::{collections::BTreeSet, io::Read, time::Duration};
use url::Url;

#[derive(Clone, Debug, Deserialize)]
pub struct SearchSkill {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub installs: u64,
}

impl SearchSkill {
    pub fn repository(&self) -> Option<&str> {
        let source = if self.source.is_empty() {
            self.id.rsplit_once('/')?.0
        } else {
            &self.source
        };
        valid_repository(source).then_some(source)
    }

    pub fn url(&self) -> String {
        let mut url = Url::parse("https://skills.sh/").unwrap();
        url.path_segments_mut().unwrap().extend(self.id.split('/'));
        url.to_string()
    }
}

pub fn valid_repository(source: &str) -> bool {
    let parts = source.split('/').collect::<Vec<_>>();
    parts.len() == 2
        && parts.iter().all(|part| {
            !part.is_empty()
                && *part != "."
                && *part != ".."
                && part
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
                && !part.starts_with('-')
        })
}

pub struct Catalog {
    base: Url,
    client: Client,
}

impl Catalog {
    pub fn new(base: &str) -> Result<Self> {
        let base = Url::parse(base).context("Invalid skills search service URL")?;
        ensure!(
            matches!(base.scheme(), "http" | "https"),
            "Search service must use HTTP or HTTPS"
        );
        Ok(Self {
            base,
            client: Client::builder()
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(20))
                .user_agent(concat!("skills-tui/", env!("CARGO_PKG_VERSION")))
                .build()?,
        })
    }

    pub fn search(&self, query: &str) -> Result<Vec<SearchSkill>> {
        ensure!(!query.trim().is_empty(), "Enter a search query");
        let mut url = self.base.join("/api/search")?;
        url.query_pairs_mut()
            .append_pair("q", query.trim())
            .append_pair("limit", "20");
        let response = self
            .client
            .get(url)
            .send()
            .context("Cannot reach the skills search service")?
            .error_for_status()
            .context("Skills search service returned an error")?;
        // The catalog is untrusted. Bound response size and reject terminal controls.
        const LIMIT: u64 = 2 * 1024 * 1024;
        let mut bytes = Vec::new();
        response.take(LIMIT + 1).read_to_end(&mut bytes)?;
        ensure!(bytes.len() as u64 <= LIMIT, "Search response is too large");
        #[derive(Deserialize)]
        struct Response {
            skills: Vec<SearchSkill>,
        }
        let mut skills = serde_json::from_slice::<Response>(&bytes)
            .context("Invalid skills search response")?
            .skills;
        let mut seen = BTreeSet::new();
        skills.retain(|skill| {
            crate::files::safe_name(&skill.name)
                && skill.repository().is_some()
                && !skill.id.is_empty()
                && !skill.id.chars().any(char::is_control)
                && seen.insert((skill.repository().unwrap().to_owned(), skill.name.clone()))
        });
        skills.sort_by_key(|skill| std::cmp::Reverse(skill.installs));
        skills.truncate(20);
        Ok(skills)
    }
}
