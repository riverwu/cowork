use serde::Serialize;

/// Fetch a URL and return the text content (HTML tags stripped).
#[tauri::command]
pub async fn web_fetch(url: String) -> Result<WebFetchResult, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read body: {}", e))?;

    // Strip HTML tags for readable text
    let text = if content_type.contains("html") {
        html_to_text(&body)
    } else {
        body.clone()
    };

    // Truncate very long content
    let max_len = 30000;
    let text = if text.len() > max_len {
        format!("{}...\n\n[Truncated, {} total characters]", &text[..max_len], text.len())
    } else {
        text
    };

    Ok(WebFetchResult {
        url,
        status,
        content_type,
        text,
    })
}

#[derive(Debug, Serialize)]
pub struct WebFetchResult {
    pub url: String,
    pub status: u16,
    pub content_type: String,
    pub text: String,
}

/// Search the web using DuckDuckGo HTML (no API key needed).
#[tauri::command]
pub async fn web_search(query: String, max_results: Option<u32>) -> Result<Vec<SearchResult>, String> {
    let max = max_results.unwrap_or(5) as usize;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    // Use DuckDuckGo HTML version (no JS needed)
    let url = format!("https://html.duckduckgo.com/html/?q={}", urlencoding::encode(&query));
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Search request failed: {}", e))?;

    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read search results: {}", e))?;

    // Parse DuckDuckGo HTML results
    let results = parse_ddg_results(&body, max);
    Ok(results)
}

#[derive(Debug, Serialize)]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

/// Parse DuckDuckGo HTML search results.
fn parse_ddg_results(html: &str, max: usize) -> Vec<SearchResult> {
    let mut results = Vec::new();

    // DuckDuckGo HTML results are in <div class="result"> blocks
    // Each has: <a class="result__a" href="...">title</a>
    //           <a class="result__snippet">snippet</a>
    for block in html.split("class=\"result results_links") {
        if results.len() >= max {
            break;
        }

        // Extract URL
        let url = extract_between(block, "class=\"result__a\" href=\"", "\"");
        if url.is_empty() || url.starts_with("/?") {
            continue;
        }
        // DuckDuckGo wraps URLs in redirect — extract actual URL
        let actual_url = if url.contains("uddg=") {
            url.split("uddg=")
                .nth(1)
                .and_then(|s| s.split('&').next())
                .map(|s| urlencoding::decode(s).unwrap_or_default().to_string())
                .unwrap_or(url.clone())
        } else {
            url.clone()
        };

        // Extract title
        let title_html = extract_between(block, "class=\"result__a\"", "</a>");
        let title = extract_between(&format!(">{}", title_html), ">", "").trim().to_string();
        let title = strip_html_tags(&title);

        // Extract snippet
        let snippet_html = extract_between(block, "class=\"result__snippet\"", "</a>");
        let snippet = extract_between(&format!(">{}", snippet_html), ">", "").trim().to_string();
        let snippet = strip_html_tags(&snippet);

        if !title.is_empty() && !actual_url.is_empty() {
            results.push(SearchResult {
                title,
                url: actual_url,
                snippet,
            });
        }
    }

    results
}

fn extract_between<'a>(text: &'a str, start: &str, end: &str) -> String {
    if let Some(start_pos) = text.find(start) {
        let after_start = &text[start_pos + start.len()..];
        if end.is_empty() {
            return after_start.to_string();
        }
        if let Some(end_pos) = after_start.find(end) {
            return after_start[..end_pos].to_string();
        }
    }
    String::new()
}

fn strip_html_tags(text: &str) -> String {
    let mut result = String::new();
    let mut in_tag = false;
    for c in text.chars() {
        if c == '<' {
            in_tag = true;
        } else if c == '>' {
            in_tag = false;
        } else if !in_tag {
            result.push(c);
        }
    }
    // Decode common HTML entities
    result
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#x27;", "'")
        .replace("&nbsp;", " ")
}

/// Strip HTML tags and extract readable text from an HTML page.
fn html_to_text(html: &str) -> String {
    // Remove script and style blocks
    let mut text = html.to_string();
    while let Some(start) = text.find("<script") {
        if let Some(end) = text[start..].find("</script>") {
            text = format!("{}{}", &text[..start], &text[start + end + 9..]);
        } else {
            break;
        }
    }
    while let Some(start) = text.find("<style") {
        if let Some(end) = text[start..].find("</style>") {
            text = format!("{}{}", &text[..start], &text[start + end + 8..]);
        } else {
            break;
        }
    }

    // Add newlines for block elements
    let text = text
        .replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n")
        .replace("</p>", "\n\n")
        .replace("</div>", "\n")
        .replace("</h1>", "\n\n")
        .replace("</h2>", "\n\n")
        .replace("</h3>", "\n\n")
        .replace("</h4>", "\n")
        .replace("</li>", "\n")
        .replace("</tr>", "\n");

    // Strip remaining tags
    let text = strip_html_tags(&text);

    // Clean up whitespace
    let lines: Vec<&str> = text
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect();

    lines.join("\n")
}
