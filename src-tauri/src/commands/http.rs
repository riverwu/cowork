use futures_util::StreamExt;
use serde::Deserialize;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Deserialize)]
pub struct HttpStreamRequest {
    pub url: String,
    pub headers: HashMap<String, String>,
    pub body: String,
}

/// Make a streaming POST request and emit SSE lines as events.
/// Returns a request_id that the frontend uses to listen for events.
#[tauri::command]
pub async fn http_stream_post(
    app: AppHandle,
    request: HttpStreamRequest,
) -> Result<String, String> {
    let request_id = uuid::Uuid::new_v4().to_string();
    let rid = request_id.clone();

    // Spawn the streaming task
    tauri::async_runtime::spawn(async move {
        let result = do_stream(&app, &rid, &request).await;
        if let Err(e) = result {
            let _ = app.emit(&format!("http-stream-{}", rid), format!("__ERROR__:{}", e));
        }
        let _ = app.emit(&format!("http-stream-{}", rid), "__DONE__".to_string());
    });

    Ok(request_id)
}

async fn do_stream(
    app: &AppHandle,
    request_id: &str,
    request: &HttpStreamRequest,
) -> Result<(), String> {
    let client = reqwest::Client::new();

    let mut req = client.post(&request.url);
    for (key, value) in &request.headers {
        req = req.header(key.as_str(), value.as_str());
    }
    req = req.header("Content-Type", "application/json");
    req = req.body(request.body.clone());

    let response = req.send().await.map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("API error {}: {}", status, body));
    }

    let event_name = format!("http-stream-{}", request_id);
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream read error: {}", e))?;
        let text = String::from_utf8_lossy(&chunk);
        buffer.push_str(&text);

        // Emit complete lines
        while let Some(newline_pos) = buffer.find('\n') {
            let line = buffer[..newline_pos].to_string();
            buffer = buffer[newline_pos + 1..].to_string();

            if line.starts_with("data: ") {
                let data = line[6..].trim().to_string();
                if !data.is_empty() {
                    let _ = app.emit(&event_name, data);
                }
            }
        }
    }

    // Flush remaining buffer
    if buffer.starts_with("data: ") {
        let data = buffer[6..].trim().to_string();
        if !data.is_empty() {
            let _ = app.emit(&event_name, data);
        }
    }

    Ok(())
}
