use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

/// Global registry of running MCP server processes.
static MCP_PROCESSES: once_cell::sync::Lazy<Arc<Mutex<HashMap<String, McpProcess>>>> =
    once_cell::sync::Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

struct McpProcess {
    stdin: tokio::process::ChildStdin,
    _child: Child,
}

#[derive(Debug, Deserialize)]
pub struct McpServerConfig {
    pub id: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: Option<HashMap<String, String>>,
}

#[derive(Debug, Serialize)]
pub struct McpSpawnResult {
    pub id: String,
    pub success: bool,
    pub error: Option<String>,
}

/// Spawn an MCP server subprocess. Stdout lines are emitted as Tauri events.
#[tauri::command]
pub async fn mcp_spawn(app: AppHandle, config: McpServerConfig) -> Result<McpSpawnResult, String> {
    let mut cmd = Command::new(&config.command);
    cmd.args(&config.args);
    cmd.stdin(std::process::Stdio::piped());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::null());

    if let Some(env) = &config.env {
        for (k, v) in env {
            cmd.env(k, v);
        }
    }

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn {}: {}", config.command, e))?;

    let stdin = child.stdin.take().ok_or("Failed to get stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;

    let server_id = config.id.clone();
    let event_name = format!("mcp-stdout-{}", server_id);

    // Spawn reader task: reads stdout lines and emits as events
    let app_clone = app.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app_clone.emit(&event_name, line);
        }
        // Process exited
        let _ = app_clone.emit(&event_name, "__MCP_EXIT__".to_string());
    });

    // Store process handle
    let mut processes = MCP_PROCESSES.lock().await;
    processes.insert(
        server_id.clone(),
        McpProcess {
            stdin,
            _child: child,
        },
    );

    Ok(McpSpawnResult {
        id: server_id,
        success: true,
        error: None,
    })
}

/// Send a JSON-RPC message to an MCP server's stdin.
#[tauri::command]
pub async fn mcp_send(server_id: String, message: String) -> Result<(), String> {
    let mut processes = MCP_PROCESSES.lock().await;
    let process = processes
        .get_mut(&server_id)
        .ok_or(format!("MCP server '{}' not found", server_id))?;

    // MCP protocol: each message is a single line followed by newline
    let msg = if message.ends_with('\n') {
        message
    } else {
        format!("{}\n", message)
    };

    process
        .stdin
        .write_all(msg.as_bytes())
        .await
        .map_err(|e| format!("Failed to write to {}: {}", server_id, e))?;

    process
        .stdin
        .flush()
        .await
        .map_err(|e| format!("Failed to flush {}: {}", server_id, e))?;

    Ok(())
}

/// Stop an MCP server process.
#[tauri::command]
pub async fn mcp_stop(server_id: String) -> Result<(), String> {
    let mut processes = MCP_PROCESSES.lock().await;
    if let Some(mut process) = processes.remove(&server_id) {
        let _ = process._child.kill().await;
    }
    Ok(())
}

/// List running MCP servers.
#[tauri::command]
pub async fn mcp_list() -> Result<Vec<String>, String> {
    let processes = MCP_PROCESSES.lock().await;
    Ok(processes.keys().cloned().collect())
}
