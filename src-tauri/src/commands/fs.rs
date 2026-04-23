use serde::Serialize;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

#[derive(Debug, Serialize)]
pub struct FileInfo {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified_at: u64, // Unix timestamp in seconds
}

/// Scan a directory and return a list of files with metadata.
/// Does not recurse into subdirectories (shallow scan).
#[tauri::command]
pub fn scan_directory(path: &str) -> Result<Vec<FileInfo>, String> {
    let dir = Path::new(path);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }

    let mut files = Vec::new();
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files
        if name.starts_with('.') {
            continue;
        }

        let modified_at = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        files.push(FileInfo {
            name,
            path: entry.path().to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            size: metadata.len(),
            modified_at,
        });
    }

    // Sort by modified_at descending (most recent first)
    files.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));

    Ok(files)
}

/// Read a text file and return its contents.
#[tauri::command]
pub fn read_file_text(path: &str) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| format!("Failed to read {}: {}", path, e))
}
