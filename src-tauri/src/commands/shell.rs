use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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
