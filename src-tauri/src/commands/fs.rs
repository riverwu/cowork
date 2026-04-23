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
