use skills_tui::catalog::Catalog;
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::mpsc,
    thread,
    time::Duration,
};

fn service(status: &str, body: &str) -> (String, mpsc::Receiver<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut request = Vec::new();
        let mut buf = [0; 1024];
        while !request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
            let count = socket.read(&mut buf).unwrap();
            if count == 0 {
                break;
            }
            request.extend_from_slice(&buf[..count]);
        }
        socket.write_all(response.as_bytes()).unwrap();
        let _ = tx.send(String::from_utf8(request).unwrap());
    });
    (base, rx)
}

#[test]
fn searches_backend_with_encoded_query_and_ranks_results() {
    let (base, request) = service(
        "200 OK",
        r#"{"skills":[
        {"id":"org/repo/first","name":"first","source":"org/repo","installs":5},
        {"id":"org/other/second","name":"second","source":"org/other","installs":200}
    ]}"#,
    );
    let results = Catalog::new(&base)
        .unwrap()
        .search("  rust & async  ")
        .unwrap();
    assert_eq!(results.len(), 2);
    assert_eq!(results[0].name, "second");
    assert_eq!(results[0].repository(), Some("org/other"));
    assert_eq!(results[0].url(), "https://skills.sh/org/other/second");
    let request = request.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(request.starts_with("GET /api/search?q=rust+%26+async&limit=20 HTTP/1.1"));
}

#[test]
fn rejects_unsafe_results_and_deduplicates_repository_skill_pairs() {
    let (base, _request) = service(
        "200 OK",
        r#"{"skills":[
        {"id":"org/repo/good","name":"good","installs":5},
        {"id":"other-id","name":"good","source":"org/repo","installs":5},
        {"id":"bad","name":"../escape","source":"org/repo"},
        {"id":"bad","name":"bad","source":"https://evil.test/repo"},
        {"id":"org/repo/control\u001b[2J","name":"control","source":"org/repo"},
        {"id":"bad","name":"bad","source":"../repo"}
    ]}"#,
    );
    let results = Catalog::new(&base).unwrap().search("test").unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].name, "good");
    assert_eq!(results[0].repository(), Some("org/repo"));
}

#[test]
fn distinguishes_empty_results_from_http_and_json_errors() {
    let (base, _) = service("200 OK", r#"{"skills":[]}"#);
    assert!(
        Catalog::new(&base)
            .unwrap()
            .search("missing")
            .unwrap()
            .is_empty()
    );
    let (base, _) = service("429 Too Many Requests", "{}");
    let error = format!(
        "{:#}",
        Catalog::new(&base).unwrap().search("rust").unwrap_err()
    );
    assert!(error.contains("429"));
    let (base, _) = service("200 OK", "not json");
    assert!(
        Catalog::new(&base)
            .unwrap()
            .search("rust")
            .unwrap_err()
            .to_string()
            .contains("Invalid")
    );
}

#[test]
fn rejects_blank_queries_without_network_access() {
    assert!(
        Catalog::new("http://127.0.0.1:1")
            .unwrap()
            .search("  ")
            .is_err()
    );
}

#[test]
#[ignore = "uses the public skills.sh service"]
fn live_catalog_search() {
    let results = Catalog::new("https://skills.sh")
        .unwrap()
        .search("rust")
        .unwrap();
    assert!(!results.is_empty());
    assert!(results.iter().all(|skill| skill.repository().is_some()));
}
