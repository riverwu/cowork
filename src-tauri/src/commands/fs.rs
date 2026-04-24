use serde::Serialize;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

#[derive(Debug, Serialize)]
pub struct FileInfo {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified_at: u64,
    pub extension: String,
}

/// Supported document extensions for indexing.
const SUPPORTED_EXTENSIONS: &[&str] = &[
    "txt", "md", "markdown", "csv", "json", "xml", "html", "htm",
    "pdf", "docx", "xlsx", "xls",
    "py", "js", "ts", "rs", "go", "java", "rb", "sh", "yaml", "yml", "toml",
];

/// Scan a directory recursively and return all supported files.
/// Skips hidden files/dirs (starting with '.') and common non-content dirs.
#[tauri::command]
pub fn scan_directory(path: &str) -> Result<Vec<FileInfo>, String> {
    let dir = Path::new(path);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }

    let skip_dirs = ["node_modules", "target", ".git", "__pycache__", "dist", "build", ".next"];
    let mut files = Vec::new();

    for entry in WalkDir::new(dir)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !name.starts_with('.') && !skip_dirs.contains(&name.as_ref())
        })
    {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        if entry.file_type().is_dir() {
            continue;
        }

        let ext = entry
            .path()
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();

        if !SUPPORTED_EXTENSIONS.contains(&ext.as_str()) {
            continue;
        }

        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        let modified_at = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        files.push(FileInfo {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry.path().to_string_lossy().to_string(),
            is_dir: false,
            size: metadata.len(),
            modified_at,
            extension: ext,
        });
    }

    // Sort by modified_at descending
    files.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));

    Ok(files)
}

/// Read a text-based file and return its contents.
#[tauri::command]
pub fn read_file_text(path: &str) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| format!("Failed to read {}: {}", path, e))
}

/// Parse a document file and extract its text content.
/// Supports: txt, md, csv, json, pdf, docx, xlsx, and other text files.
#[tauri::command]
pub fn parse_document(path: &str) -> Result<String, String> {
    let file_path = Path::new(path);
    let ext = file_path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    match ext.as_str() {
        "pdf" => parse_pdf(path),
        "docx" => parse_docx(path),
        "xlsx" | "xls" => parse_xlsx(path),
        // All other supported types are plain text
        _ => fs::read_to_string(path)
            .map_err(|e| format!("Failed to read {}: {}", path, e)),
    }
}

fn parse_pdf(path: &str) -> Result<String, String> {
    let doc = lopdf::Document::load(path).map_err(|e| format!("PDF load error: {}", e))?;
    let mut text = String::new();

    let pages: Vec<u32> = doc.get_pages().keys().copied().collect();
    for page_id in pages {
        if let Ok(page_text) = doc.extract_text(&[page_id]) {
            text.push_str(&page_text);
            text.push('\n');
        }
    }

    if text.trim().is_empty() {
        return Err("PDF appears to be scanned/image-based — no text extracted".into());
    }

    Ok(text)
}

fn parse_docx(path: &str) -> Result<String, String> {
    let data = fs::read(path).map_err(|e| format!("Failed to read {}: {}", path, e))?;
    let docx = docx_rs::read_docx(&data).map_err(|e| format!("DOCX parse error: {}", e))?;

    let mut text = String::new();
    for child in docx.document.children {
        if let docx_rs::DocumentChild::Paragraph(para) = child {
            for child in &para.children {
                if let docx_rs::ParagraphChild::Run(run) = child {
                    for child in &run.children {
                        if let docx_rs::RunChild::Text(t) = child {
                            text.push_str(&t.text);
                        }
                    }
                }
            }
            text.push('\n');
        }
    }

    Ok(text)
}

fn parse_xlsx(path: &str) -> Result<String, String> {
    use calamine::{open_workbook_auto, Data, Reader};

    let mut workbook = open_workbook_auto(path).map_err(|e| format!("XLSX open error: {}", e))?;
    let mut text = String::new();
    let sheet_names: Vec<String> = workbook.sheet_names().to_vec();

    for name in sheet_names {
        if let Ok(range) = workbook.worksheet_range(&name) {
            text.push_str(&format!("## Sheet: {}\n", name));
            for row in range.rows() {
                let cells: Vec<String> = row
                    .iter()
                    .map(|cell: &Data| format!("{}", cell))
                    .collect();
                text.push_str(&cells.join("\t"));
                text.push('\n');
            }
            text.push('\n');
        }
    }

    Ok(text)
}

/// Open a file or folder in the system's default application.
#[tauri::command]
pub fn open_path(path: &str) -> Result<(), String> {
    opener::open(std::path::Path::new(path)).map_err(|e| format!("Failed to open: {}", e))
}

/// Reveal a file in Finder/Explorer (open its parent folder).
#[tauri::command]
pub fn reveal_in_folder(path: &str) -> Result<(), String> {
    let p = std::path::Path::new(path);
    let folder = p.parent().unwrap_or(p);
    opener::open(folder).map_err(|e| format!("Failed to reveal: {}", e))
}

/// Write content to a file. Creates parent directories if needed.
#[tauri::command]
pub fn write_file(path: &str, content: &str) -> Result<(), String> {
    let file_path = Path::new(path);
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    fs::write(path, content).map_err(|e| format!("Failed to write {}: {}", path, e))
}

/// List directory contents (non-recursive).
#[tauri::command]
pub fn list_directory(path: &str) -> Result<Vec<FileInfo>, String> {
    let dir = Path::new(path);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }

    let mut entries = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = match entry { Ok(e) => e, Err(_) => continue };
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') { continue; }
        let metadata = match entry.metadata() { Ok(m) => m, Err(_) => continue };
        let modified_at = metadata.modified().ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs()).unwrap_or(0);
        let ext = Path::new(&name).extension()
            .map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
        entries.push(FileInfo {
            name, path: entry.path().to_string_lossy().to_string(),
            is_dir: metadata.is_dir(), size: metadata.len(), modified_at, extension: ext,
        });
    }
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(entries)
}

#[derive(Debug, Serialize)]
pub struct GrepMatch {
    pub path: String,
    pub line_number: u32,
    pub line: String,
}

/// Search file contents recursively for a pattern.
#[tauri::command]
pub fn grep(directory: &str, pattern: &str, max_results: Option<u32>) -> Result<Vec<GrepMatch>, String> {
    let dir = Path::new(directory);
    if !dir.is_dir() { return Err(format!("Not a directory: {}", directory)); }
    let max = max_results.unwrap_or(50) as usize;
    let skip_dirs = ["node_modules", "target", ".git", "__pycache__", "dist", "build"];
    let mut results = Vec::new();

    for entry in WalkDir::new(dir).follow_links(false).into_iter()
        .filter_entry(|e| { let n = e.file_name().to_string_lossy(); !n.starts_with('.') && !skip_dirs.contains(&n.as_ref()) })
    {
        if results.len() >= max { break; }
        let entry = match entry { Ok(e) => e, Err(_) => continue };
        if !entry.file_type().is_file() { continue; }
        if let Ok(meta) = entry.metadata() { if meta.len() > 1_000_000 { continue; } }
        let content = match fs::read_to_string(entry.path()) { Ok(c) => c, Err(_) => continue };
        for (i, line) in content.lines().enumerate() {
            if results.len() >= max { break; }
            if line.contains(pattern) {
                results.push(GrepMatch {
                    path: entry.path().to_string_lossy().to_string(),
                    line_number: (i + 1) as u32,
                    line: line.to_string(),
                });
            }
        }
    }
    Ok(results)
}

#[derive(Debug, Serialize)]
pub struct PythonResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

/// Execute Python script in the isolated environment.
#[tauri::command]
pub async fn run_python_script(script: String, timeout_secs: Option<u64>) -> Result<PythonResult, String> {
    use std::process::Stdio;
    use tokio::process::Command;
    use tokio::time::{timeout, Duration};

    let home = dirs_next::home_dir().ok_or("Cannot find home directory")?;
    let venv_python = home.join(".cowork/python/venv/bin/python3");
    if !venv_python.exists() {
        return Err("Python environment not initialized. Run init_python_env first.".to_string());
    }

    let duration = Duration::from_secs(timeout_secs.unwrap_or(30));
    let result = timeout(duration, async {
        let output = Command::new(venv_python.to_str().unwrap())
            .arg("-c").arg(&script)
            .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped())
            .output().await.map_err(|e| format!("Failed to run Python: {}", e))?;
        Ok::<PythonResult, String>(PythonResult {
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code().unwrap_or(-1),
        })
    }).await.map_err(|_| format!("Python timed out after {}s", timeout_secs.unwrap_or(30)))?;
    result
}

/// Initialize isolated Python environment via uv.
#[tauri::command]
pub async fn init_python_env() -> Result<String, String> {
    use tokio::process::Command;

    let home = dirs_next::home_dir().ok_or("Cannot find home directory")?;
    let cowork_dir = home.join(".cowork/python");
    let venv_dir = cowork_dir.join("venv");

    if venv_dir.join("bin/python3").exists() {
        return Ok("Python environment already initialized.".to_string());
    }

    fs::create_dir_all(&cowork_dir).map_err(|e| format!("Failed to create dir: {}", e))?;
    let uv = which_uv().await?;

    let out = Command::new(&uv).args(["venv", venv_dir.to_str().unwrap(), "--python", "3.12"])
        .output().await.map_err(|e| format!("uv venv failed: {}", e))?;
    if !out.status.success() { return Err(format!("uv venv: {}", String::from_utf8_lossy(&out.stderr))); }

    let out = Command::new(&uv).args(["pip", "install", "--python", venv_dir.join("bin/python3").to_str().unwrap(),
        "pandas", "openpyxl", "python-docx", "matplotlib", "PyPDF2"])
        .output().await.map_err(|e| format!("pip install failed: {}", e))?;
    if !out.status.success() { return Err(format!("pip install: {}", String::from_utf8_lossy(&out.stderr))); }

    Ok("Python environment initialized.".to_string())
}

/// Install a Python package into the isolated environment.
#[tauri::command]
pub async fn install_python_package(package: String) -> Result<String, String> {
    use tokio::process::Command;
    let home = dirs_next::home_dir().ok_or("Cannot find home directory")?;
    let venv_python = home.join(".cowork/python/venv/bin/python3");
    if !venv_python.exists() { return Err("Python environment not initialized.".to_string()); }
    let uv = which_uv().await?;
    let out = Command::new(&uv).args(["pip", "install", "--python", venv_python.to_str().unwrap(), &package])
        .output().await.map_err(|e| format!("Install failed: {}", e))?;
    if out.status.success() { Ok(format!("Installed {}", package)) }
    else { Err(format!("Failed: {}", String::from_utf8_lossy(&out.stderr))) }
}

async fn which_uv() -> Result<String, String> {
    let home = dirs_next::home_dir().ok_or("Cannot find home dir")?;
    let candidates = [
        home.join(".cargo/bin/uv"),
        home.join(".local/bin/uv"),
        home.join(".local/share/uv/bin/uv"),
        std::path::PathBuf::from("/usr/local/bin/uv"),
        std::path::PathBuf::from("/opt/homebrew/bin/uv"),
    ];
    for p in &candidates {
        if p.exists() { return Ok(p.to_string_lossy().to_string()); }
    }
    // Try PATH lookup with expanded PATH
    let expanded = super::mcp::expanded_path_str();
    if let Ok(out) = tokio::process::Command::new("sh")
        .args(["-c", &format!("PATH='{}' command -v uv", expanded)])
        .output().await
    {
        if out.status.success() {
            let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !p.is_empty() { return Ok(p); }
        }
    }
    Err("uv not found. Install: https://docs.astral.sh/uv/getting-started/installation/".to_string())
}

// ---- Node.js isolated environment ----

/// Get the cowork node environment directory (~/.cowork/node).
fn node_env_dir() -> Result<std::path::PathBuf, String> {
    let home = dirs_next::home_dir().ok_or("Cannot find home directory")?;
    Ok(home.join(".cowork/node"))
}

/// Initialize the isolated Node.js environment for package installs.
/// Creates ~/.cowork/node/ with a minimal package.json.
#[tauri::command]
pub async fn init_node_env() -> Result<String, String> {
    let dir = node_env_dir()?;
    let pkg_json = dir.join("package.json");

    if pkg_json.exists() {
        return Ok("Node environment already initialized.".to_string());
    }

    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create dir: {}", e))?;
    fs::write(&pkg_json, r#"{"name":"cowork-node-env","version":"1.0.0","private":true}"#)
        .map_err(|e| format!("Failed to write package.json: {}", e))?;

    Ok("Node environment initialized.".to_string())
}

/// Install an npm package into the isolated environment.
#[tauri::command]
pub async fn install_node_package(package: String) -> Result<String, String> {
    use tokio::process::Command;

    let dir = node_env_dir()?;
    if !dir.join("package.json").exists() {
        init_node_env().await?;
    }

    let expanded_path = super::mcp::expanded_path_str();
    let out = Command::new("npm")
        .args(["install", "--save", &package])
        .current_dir(&dir)
        .env("PATH", &expanded_path)
        .output()
        .await
        .map_err(|e| format!("npm install failed: {}", e))?;

    if out.status.success() {
        Ok(format!("Installed {}", package))
    } else {
        Err(format!("npm install failed: {}", String::from_utf8_lossy(&out.stderr)))
    }
}

/// Get the NODE_PATH for the isolated environment.
#[tauri::command]
pub async fn get_node_path() -> Result<String, String> {
    let dir = node_env_dir()?;
    Ok(dir.join("node_modules").to_string_lossy().to_string())
}
