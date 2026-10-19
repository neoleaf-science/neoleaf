//! Stateless proxy for article searches the browser cannot reach on its own (CORS): arXiv and DBLP.
//!
//! The other sources (Crossref, OpenAlex, PubMed...) allow the browser and are queried directly from there. Here the server only relays
//! the question and returns the answer: nothing is stored, and the queried address is built HERE from a fixed host (the client only
//! supplies source, text and page), so it is not an open proxy. An article search is not project content, but for privacy the query
//! goes to no log.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Contact sent to the sources (arXiv and DBLP ask API callers to identify themselves).
pub const CONTACT: &str = "contact@neoleaf.science";

const MAX_QUERY_CHARS: usize = 300;
const MAX_BODY: usize = 2 * 1024 * 1024;
const MAX_LIMIT: u32 = 30;
const MAX_OFFSET: u32 = 500;
const TIMEOUT: Duration = Duration::from_secs(20);
/// Requests per person per window (memory only; resets on restart).
const RATE_MAX: usize = 30;
const RATE_WINDOW: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    Arxiv,
    Dblp,
}

impl Source {
    pub fn parse(s: &str) -> Option<Source> {
        match s {
            "arxiv" => Some(Source::Arxiv),
            "dblp" => Some(Source::Dblp),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Source::Arxiv => "arXiv",
            Source::Dblp => "DBLP",
        }
    }

    pub fn content_type(self) -> &'static str {
        match self {
            Source::Arxiv => "application/xml; charset=utf-8",
            Source::Dblp => "application/json; charset=utf-8",
        }
    }

    /// API address (`SCHOLAR_ARXIV_URL` and `SCHOLAR_DBLP_URL` swap it for a test server).
    fn base(self) -> String {
        let (var, default) = match self {
            Source::Arxiv => ("SCHOLAR_ARXIV_URL", "https://export.arxiv.org/api/query"),
            Source::Dblp => ("SCHOLAR_DBLP_URL", "https://dblp.org/search/publ/api"),
        };
        std::env::var(var)
            .ok()
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| default.to_string())
    }
}

/// Checks the search text: non-empty, short and without control characters.
pub fn valid_query(q: &str) -> Result<String, &'static str> {
    let q = q.trim();
    if q.is_empty() {
        return Err("Enter what to search for");
    }
    if q.chars().count() > MAX_QUERY_CHARS {
        return Err("Search is too long");
    }
    if q.chars().any(|c| c.is_control()) {
        return Err("Invalid search");
    }
    Ok(q.to_string())
}

pub fn clamp_limit(v: Option<u32>) -> u32 {
    v.unwrap_or(10).clamp(1, MAX_LIMIT)
}

pub fn clamp_offset(v: Option<u32>) -> u32 {
    v.unwrap_or(0).min(MAX_OFFSET)
}

/// On arXiv, each word becomes `all:word` joined by AND (a loose phrase would be read as OR).
fn arxiv_query(q: &str) -> String {
    q.split_whitespace()
        .map(|w| w.trim_matches('"'))
        .filter(|w| !w.is_empty())
        .map(|w| format!("all:{w}"))
        .collect::<Vec<_>>()
        .join(" AND ")
}

pub fn build_url(src: Source, q: &str, limit: u32, offset: u32) -> String {
    let base = src.base();
    match src {
        Source::Arxiv => format!(
            "{base}?search_query={}&start={offset}&max_results={limit}",
            urlencoding::encode(&arxiv_query(q))
        ),
        Source::Dblp => format!(
            "{base}?q={}&format=json&h={limit}&f={offset}",
            urlencoding::encode(q)
        ),
    }
}

async fn get_once(client: &reqwest::Client, url: &str) -> Result<(u16, Vec<u8>), String> {
    let mut resp = client
        .get(url)
        .header(
            "User-Agent",
            format!("NeoLeaf/1.0 (+https://neoleaf.science; mailto:{CONTACT})"),
        )
        .send()
        .await
        .map_err(|_| "Could not query the source".to_string())?;
    let status = resp.status().as_u16();
    let mut body = Vec::new();
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|_| "The source interrupted the response".to_string())?
    {
        if body.len() + chunk.len() > MAX_BODY {
            return Err("Response is too large".to_string());
        }
        body.extend_from_slice(&chunk);
    }
    Ok((status, body))
}

/// Queries the source and returns the body (arXiv XML or DBLP JSON).
pub async fn fetch(src: Source, q: &str, limit: u32, offset: u32) -> Result<Vec<u8>, String> {
    let url = build_url(src, q, limit, offset);
    let client = reqwest::Client::builder()
        .timeout(TIMEOUT)
        .build()
        .map_err(|_| "Failed to prepare the query".to_string())?;
    let (mut status, mut body) = get_once(&client, &url).await?;
    if status == 202 {
        // DBLP answers 202 while it builds the response: a second attempt usually suffices
        tokio::time::sleep(Duration::from_millis(1500)).await;
        (status, body) = get_once(&client, &url).await?;
    }
    if status == 200 {
        Ok(body)
    } else if status == 429 || status == 503 {
        Err(format!(
            "{} is rate limiting queries right now; try again in a moment",
            src.name()
        ))
    } else {
        Err(format!("{} responded with an error ({status})", src.name()))
    }
}

static LIMITER: OnceLock<Mutex<HashMap<String, Vec<Instant>>>> = OnceLock::new();

/// Per-person request limit (memory only). `false` = over the limit.
pub fn allow(key: &str) -> bool {
    allow_max(key, RATE_MAX)
}

/// Same window with another maximum (the package proxy needs a higher one than the paper search).
pub fn allow_max(key: &str, max: usize) -> bool {
    allow_at_max(key, Instant::now(), max)
}

#[cfg(test)]
fn allow_at(key: &str, now: Instant) -> bool {
    allow_at_max(key, now, RATE_MAX)
}

fn allow_at_max(key: &str, now: Instant, max: usize) -> bool {
    let mut map = LIMITER
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if map.len() > 5000 {
        map.retain(|_, v| {
            v.last()
                .is_some_and(|t| now.duration_since(*t) < RATE_WINDOW)
        });
    }
    let hits = map.entry(key.to_string()).or_default();
    hits.retain(|t| now.duration_since(*t) < RATE_WINDOW);
    if hits.len() >= max {
        return false;
    }
    hits.push(now);
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_the_two_known_sources() {
        assert_eq!(Source::parse("arxiv"), Some(Source::Arxiv));
        assert_eq!(Source::parse("dblp"), Some(Source::Dblp));
        for bad in ["", "crossref", "ARXIV", "arxiv/../x", "http://example.org"] {
            assert_eq!(Source::parse(bad), None, "{bad}");
        }
    }

    #[test]
    fn validates_the_search_text() {
        assert_eq!(valid_query("  deep learning ").unwrap(), "deep learning");
        assert!(valid_query("   ").is_err());
        assert!(valid_query(&"a".repeat(301)).is_err());
        assert!(valid_query("a\nb").is_err());
        assert!(valid_query(&"a".repeat(300)).is_ok());
    }

    #[test]
    fn limits_page_and_offset() {
        assert_eq!(clamp_limit(None), 10);
        assert_eq!(clamp_limit(Some(0)), 1);
        assert_eq!(clamp_limit(Some(9999)), 30);
        assert_eq!(clamp_offset(None), 0);
        assert_eq!(clamp_offset(Some(10_000)), 500);
    }

    #[test]
    fn builds_the_address_on_the_fixed_host_and_encodes_the_text() {
        let u = build_url(Source::Arxiv, "machine learning & \"x\"", 10, 20);
        assert!(
            u.starts_with("https://export.arxiv.org/api/query?search_query="),
            "{u}"
        );
        assert!(
            u.contains("all%3Amachine%20AND%20all%3Alearning%20AND%20all%3A%26%20AND%20all%3Ax"),
            "{u}"
        );
        assert!(u.ends_with("&start=20&max_results=10"), "{u}");
        let d = build_url(Source::Dblp, "a b#c", 5, 0);
        assert_eq!(
            d,
            "https://dblp.org/search/publ/api?q=a%20b%23c&format=json&h=5&f=0"
        );
        // nothing in the person's text changes the host
        assert!(!build_url(Source::Dblp, "@evil.com/", 5, 0).contains("evil.com@"));
    }

    #[test]
    fn limits_requests_per_person_in_a_window() {
        let t0 = Instant::now();
        for i in 0..RATE_MAX {
            assert!(
                allow_at("person-test-a", t0 + Duration::from_millis(i as u64)),
                "{i}"
            );
        }
        assert!(!allow_at("person-test-a", t0 + Duration::from_secs(1)));
        assert!(
            allow_at("person-test-b", t0 + Duration::from_secs(1)),
            "another person is not affected"
        );
        assert!(
            allow_at("person-test-a", t0 + RATE_WINDOW + Duration::from_secs(1)),
            "the window passes"
        );
    }

    #[test]
    fn another_maximum_applies_to_its_own_key() {
        let t0 = Instant::now();
        for i in 0..100 {
            assert!(
                allow_at_max("ctan-test", t0 + Duration::from_millis(i), 100),
                "{i}"
            );
        }
        assert!(!allow_at_max("ctan-test", t0 + Duration::from_secs(1), 100));
        assert!(allow_at_max(
            "ctan-test",
            t0 + RATE_WINDOW + Duration::from_secs(1),
            100
        ));
    }
}
