use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::time::{timeout, Duration};

#[derive(Debug, Deserialize)]
pub struct ShellExecParams {
    pub command: Vec<String>,
    pub cwd: Option<String>,
    pub env: Option<HashMap<String, String>>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct ShellExecResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub timed_out: bool,
}

/// Execute a shell command with timeout and working directory support.
/// Returns stdout, stderr, exit code, and whether it timed out.
#[tauri::command]
pub async fn shell_exec(params: ShellExecParams) -> Result<ShellExecResult, String> {
    if params.command.is_empty() {
        return Err("Empty command".to_string());
    }

    let (program, args) = (&params.command[0], &params.command[1..]);
    let mut cmd = Command::new(program);
    cmd.args(args);

    // Expand PATH for GUI apps
    cmd.env("PATH", super::mcp::expanded_path_str());

    if let Some(cwd) = &params.cwd {
        cmd.current_dir(cwd);
    }

    if let Some(env) = &params.env {
        for (k, v) in env {
            cmd.env(k, v);
        }
    }

    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let timeout_ms = params.timeout_ms.unwrap_or(30_000);
    let duration = Duration::from_millis(timeout_ms);

    match timeout(duration, cmd.output()).await {
        Ok(Ok(output)) => Ok(ShellExecResult {
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code().unwrap_or(-1),
            timed_out: false,
        }),
        Ok(Err(e)) => Err(format!("Command failed: {}", e)),
        Err(_) => Ok(ShellExecResult {
            stdout: String::new(),
            stderr: format!("Command timed out after {}ms", timeout_ms),
            exit_code: -1,
            timed_out: true,
        }),
    }
}

/// Execute a shell command with streaming output via Tauri events.
/// Emits `shell-output-{event_id}` for each line of stdout/stderr.
/// Returns the same ShellExecResult when the process completes.
#[tauri::command]
pub async fn shell_exec_stream(
    app: AppHandle,
    params: ShellExecParams,
    event_id: String,
) -> Result<ShellExecResult, String> {
    if params.command.is_empty() {
        return Err("Empty command".to_string());
    }

    let (program, args) = (&params.command[0], &params.command[1..]);
    let mut cmd = Command::new(program);
    cmd.args(args);
    cmd.env("PATH", super::mcp::expanded_path_str());

    if let Some(cwd) = &params.cwd {
        cmd.current_dir(cwd);
    }
    if let Some(env) = &params.env {
        for (k, v) in env {
            cmd.env(k, v);
        }
    }

    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let timeout_ms = params.timeout_ms.unwrap_or(30_000);
    let duration = Duration::from_millis(timeout_ms);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Command failed: {}", e))?;

    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to get stderr")?;

    let event_name = format!("shell-output-{}", event_id);
    let full_stdout = std::sync::Arc::new(tokio::sync::Mutex::new(String::new()));
    let full_stderr = std::sync::Arc::new(tokio::sync::Mutex::new(String::new()));

    // Stream stdout
    let app_out = app.clone();
    let event_out = event_name.clone();
    let stdout_buf = full_stdout.clone();
    let stdout_task = tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            stdout_buf.lock().await.push_str(&line);
            stdout_buf.lock().await.push('\n');
            let _ = app_out.emit(&event_out, &line);
        }
    });

    // Stream stderr
    let app_err = app.clone();
    let event_err = event_name.clone();
    let stderr_buf = full_stderr.clone();
    let stderr_task = tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            stderr_buf.lock().await.push_str(&line);
            stderr_buf.lock().await.push('\n');
            let _ = app_err.emit(&event_err, format!("[stderr] {}", line));
        }
    });

    // Wait for process with timeout
    match timeout(duration, child.wait()).await {
        Ok(Ok(status)) => {
            let _ = tokio::join!(stdout_task, stderr_task);
            Ok(ShellExecResult {
                stdout: full_stdout.lock().await.clone(),
                stderr: full_stderr.lock().await.clone(),
                exit_code: status.code().unwrap_or(-1),
                timed_out: false,
            })
        }
        Ok(Err(e)) => Err(format!("Command failed: {}", e)),
        Err(_) => {
            let _ = child.kill().await;
            Ok(ShellExecResult {
                stdout: full_stdout.lock().await.clone(),
                stderr: full_stderr.lock().await.clone(),
                exit_code: -1,
                timed_out: true,
            })
        }
    }
}
