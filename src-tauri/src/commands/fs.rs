use serde::{Deserialize, Serialize};
use std::collections::{hash_map::DefaultHasher, HashSet};
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::process::Command;
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;
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

#[derive(Debug, Serialize)]
pub struct ExtractedTextCacheResult {
    pub cache_path: String,
    pub preview: String,
    pub char_count: usize,
    pub byte_count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct NativeIndexProgress {
    pub job_id: String,
    pub source_id: String,
    pub phase: String,
    pub current: usize,
    pub total: usize,
    pub filename: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct NativeIndexedFile {
    pub job_id: String,
    pub source_id: String,
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified_at: u64,
    pub extension: String,
    pub cache_path: Option<String>,
    pub preview: Option<String>,
    pub char_count: Option<usize>,
    pub byte_count: Option<usize>,
    pub error: Option<String>,
    pub unchanged: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct NativeIndexedFilesBatch {
    pub job_id: String,
    pub source_id: String,
    pub files: Vec<NativeIndexedFile>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NativeKnownFile {
    pub content_hash: String,
}

const NATIVE_INDEX_EVENT_BATCH_SIZE: usize = 24;
const NATIVE_INDEX_PROGRESS_EVERY: usize = 25;

/// Scan a directory recursively and return all regular files.
/// The indexer decides which files support content extraction and which files
/// should be cataloged as metadata-only entries.
/// Skips hidden files/dirs (starting with '.') and common non-content dirs.
#[tauri::command]
pub async fn scan_directory(path: String) -> Result<Vec<FileInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || scan_directory_impl(&path))
        .await
        .map_err(|e| format!("Directory scan task failed: {}", e))?
}

fn scan_directory_impl(path: &str) -> Result<Vec<FileInfo>, String> {
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
/// Supports: txt, md/markdown, csv, json, pdf, doc/docx, xlsx, and other text files.
#[tauri::command]
pub fn parse_document(path: &str) -> Result<String, String> {
    let file_path = Path::new(path);
    let ext = file_path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    match ext.as_str() {
        "pdf" => parse_pdf(path),
        "doc" => parse_doc(path),
        "docx" => parse_docx(path),
        "xlsx" | "xls" => parse_xlsx(path),
        "pptx" | "ppt" => Err(
            "PPTX text extraction is not supported by parse_document. Use the pptx skill.".into(),
        ),
        // All other supported types are plain text
        _ => fs::read_to_string(path)
            .map_err(|e| format!("Failed to read {}: {}", path, e)),
    }
}

/// Parse a document and write the full extracted text directly to a cache file.
/// Returns only a bounded preview to JS so indexing does not move large
/// document text through the WebView process.
#[tauri::command]
pub async fn extract_document_text_to_cache(
    path: String,
    cache_path: String,
    preview_chars: Option<usize>,
) -> Result<ExtractedTextCacheResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        extract_document_text_to_cache_impl(&path, &cache_path, preview_chars)
    })
        .await
        .map_err(|e| format!("Document extraction task failed: {}", e))?
}

fn extract_document_text_to_cache_impl(
    path: &str,
    cache_path: &str,
    preview_chars: Option<usize>,
) -> Result<ExtractedTextCacheResult, String> {
    let text = parse_document(path)?;
    if text.trim().is_empty() {
        return Err("Document appears to contain no extractable text".into());
    }

    let cache = Path::new(cache_path);
    if let Some(parent) = cache.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create text cache directory: {}", e))?;
    }
    fs::write(cache, text.as_bytes())
        .map_err(|e| format!("Failed to write extracted text cache: {}", e))?;

    let limit = preview_chars.unwrap_or(24_000).clamp(1_000, 80_000);
    let preview: String = text.chars().take(limit).collect();
    Ok(ExtractedTextCacheResult {
        cache_path: cache_path.to_string(),
        preview,
        char_count: text.chars().count(),
        byte_count: text.len(),
    })
}

/// Start a native background index scan/extract job. The job emits:
/// - knowledge-index-progress
/// - knowledge-index-file
/// - knowledge-index-done
///
/// JS receives only file metadata and bounded previews. Full extracted text is
/// written directly to .cowork-text-cache from Rust.
#[tauri::command]
pub fn start_knowledge_index(
    app: AppHandle,
    source_id: String,
    path: String,
    known_files: Option<Vec<NativeKnownFile>>,
) -> Result<String, String> {
    let job_id = Uuid::new_v4().to_string();
    let job_id_for_task = job_id.clone();
    let known_hashes: HashSet<String> = known_files
        .unwrap_or_default()
        .into_iter()
        .map(|file| file.content_hash)
        .collect();

    tauri::async_runtime::spawn_blocking(move || {
        run_knowledge_index_job(app, job_id_for_task, source_id, path, known_hashes);
    });

    Ok(job_id)
}

fn run_knowledge_index_job(
    app: AppHandle,
    job_id: String,
    source_id: String,
    path: String,
    known_hashes: HashSet<String>,
) {
    emit_index_progress(&app, &job_id, &source_id, "scan", 0, 0, None, "Scanning directory");

    let files = match scan_directory_impl(&path) {
        Ok(files) => files,
        Err(err) => {
            let _ = app.emit("knowledge-index-done", NativeIndexProgress {
                job_id,
                source_id,
                phase: "error".into(),
                current: 0,
                total: 0,
                filename: None,
                message: err,
            });
            return;
        }
    };

    let total = files.len();
    emit_index_progress(&app, &job_id, &source_id, "extract", 0, total, None, "Extracting text");
    let mut batch: Vec<NativeIndexedFile> = Vec::with_capacity(NATIVE_INDEX_EVENT_BATCH_SIZE);

    for (idx, file) in files.into_iter().enumerate() {
        let current = idx + 1;
        if current == 1 || current == total || current % NATIVE_INDEX_PROGRESS_EVERY == 0 {
            emit_index_progress(
                &app,
                &job_id,
                &source_id,
                "extract",
                current,
                total,
                Some(file.name.clone()),
                "Extracting text",
            );
        }

        let mut indexed = NativeIndexedFile {
            job_id: job_id.clone(),
            source_id: source_id.clone(),
            name: file.name.clone(),
            path: file.path.clone(),
            is_dir: file.is_dir,
            size: file.size,
            modified_at: file.modified_at,
            extension: file.extension.clone(),
            cache_path: None,
            preview: None,
            char_count: None,
            byte_count: None,
            error: None,
            unchanged: known_hashes.contains(&file_fingerprint(&file)),
        };

        if indexed.unchanged {
            push_indexed_file_batch(&app, &job_id, &source_id, &mut batch, indexed);
            continue;
        }

        if is_content_indexable_extension(&file.extension) {
            let cache_path = native_cache_path_for_file(&file.path);
            match extract_document_text_to_cache_impl(&file.path, &cache_path, Some(24_000)) {
                Ok(result) => {
                    indexed.cache_path = Some(result.cache_path);
                    indexed.preview = Some(result.preview);
                    indexed.char_count = Some(result.char_count);
                    indexed.byte_count = Some(result.byte_count);
                }
                Err(err) => {
                    indexed.error = Some(format!("Text extraction failed: {}", err));
                }
            }
        }

        push_indexed_file_batch(&app, &job_id, &source_id, &mut batch, indexed);
    }
    flush_indexed_file_batch(&app, &job_id, &source_id, &mut batch);

    let _ = app.emit("knowledge-index-done", NativeIndexProgress {
        job_id,
        source_id,
        phase: "done".into(),
        current: total,
        total,
        filename: None,
        message: "Index extraction complete".into(),
    });
}

fn push_indexed_file_batch(
    app: &AppHandle,
    job_id: &str,
    source_id: &str,
    batch: &mut Vec<NativeIndexedFile>,
    file: NativeIndexedFile,
) {
    batch.push(file);
    if batch.len() >= NATIVE_INDEX_EVENT_BATCH_SIZE {
        flush_indexed_file_batch(app, job_id, source_id, batch);
    }
}

fn flush_indexed_file_batch(
    app: &AppHandle,
    job_id: &str,
    source_id: &str,
    batch: &mut Vec<NativeIndexedFile>,
) {
    if batch.is_empty() {
        return;
    }
    let files = std::mem::take(batch);
    let _ = app.emit("knowledge-index-files", NativeIndexedFilesBatch {
        job_id: job_id.to_string(),
        source_id: source_id.to_string(),
        files,
    });
}

fn emit_index_progress(
    app: &AppHandle,
    job_id: &str,
    source_id: &str,
    phase: &str,
    current: usize,
    total: usize,
    filename: Option<String>,
    message: &str,
) {
    let _ = app.emit("knowledge-index-progress", NativeIndexProgress {
        job_id: job_id.to_string(),
        source_id: source_id.to_string(),
        phase: phase.to_string(),
        current,
        total,
        filename,
        message: message.to_string(),
    });
}

fn is_content_indexable_extension(ext: &str) -> bool {
    matches!(
        ext.to_lowercase().as_str(),
        "txt" | "md" | "markdown" | "csv" | "json" | "xml" | "html" | "htm"
            | "pdf" | "doc" | "docx" | "xlsx" | "xls"
            | "py" | "js" | "ts" | "rs" | "go" | "java" | "rb" | "sh"
            | "yaml" | "yml" | "toml"
    )
}

fn native_cache_path_for_file(file_path: &str) -> String {
    let path = Path::new(file_path);
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    let mut hasher = DefaultHasher::new();
    file_path.hash(&mut hasher);
    let hash = hasher.finish();
    dir.join(".cowork-text-cache")
        .join(format!("{:016x}.txt", hash))
        .to_string_lossy()
        .to_string()
}

fn file_fingerprint(file: &FileInfo) -> String {
    format!("{}:{}:{}", file.path, file.size, file.modified_at)
}

fn parse_doc(path: &str) -> Result<String, String> {
    let output = Command::new("textutil")
        .args(["-convert", "txt", "-stdout", path])
        .output()
        .map_err(|e| format!("DOC parse error: textutil not available or failed to start: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "DOC parse error: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let text = String::from_utf8_lossy(&output.stdout).to_string();
    if text.trim().is_empty() {
        return Err("DOC appears to contain no extractable text".into());
    }

    Ok(text)
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

    let form_text = extract_pdf_form_text(&doc);
    if !form_text.trim().is_empty() {
        text.push_str(&form_text);
        text.push('\n');
    }

    if text.trim().is_empty() {
        if let Ok(ocr_text) = ocr_pdf_with_macos_vision(path) {
            text.push_str(&ocr_text);
            text.push('\n');
        }
    }

    if text.trim().is_empty() {
        return Err("PDF appears to be scanned/image-based or form-only with no extractable text".into());
    }

    Ok(text)
}

fn ocr_pdf_with_macos_vision(path: &str) -> Result<String, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        return Err("PDF OCR fallback is only available on macOS".into());
    }

    #[cfg(target_os = "macos")]
    {
        let swift = Path::new("/usr/bin/swift");
        if !swift.exists() {
            return Err("macOS Vision OCR fallback requires /usr/bin/swift".into());
        }

        let temp_dir = std::env::temp_dir().join("cowork-ocr");
        fs::create_dir_all(&temp_dir)
            .map_err(|e| format!("Failed to create OCR temp dir: {}", e))?;
        let script_path = temp_dir.join("pdf_vision_ocr.swift");
        fs::write(&script_path, MACOS_VISION_OCR_SWIFT)
            .map_err(|e| format!("Failed to write OCR script: {}", e))?;

        let output = Command::new(swift)
            .env("CLANG_MODULE_CACHE_PATH", temp_dir.join("clang-cache"))
            .arg(&script_path)
            .arg(path)
            .output()
            .map_err(|e| format!("Failed to start macOS Vision OCR: {}", e))?;

        if !output.status.success() {
            return Err(format!(
                "macOS Vision OCR failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }

        let text = String::from_utf8_lossy(&output.stdout).to_string();
        if text.trim().is_empty() {
            return Err("macOS Vision OCR produced no text".into());
        }
        Ok(text)
    }
}

#[cfg(target_os = "macos")]
const MACOS_VISION_OCR_SWIFT: &str = r#"
import Foundation
import PDFKit
import Vision
import AppKit

let path = CommandLine.arguments[1]
guard let document = PDFDocument(url: URL(fileURLWithPath: path)) else {
    fputs("Unable to open PDF\n", stderr)
    exit(2)
}

for pageIndex in 0..<document.pageCount {
    guard let page = document.page(at: pageIndex) else { continue }
    let bounds = page.bounds(for: .mediaBox)
    let width: CGFloat = 1400
    let height = max(1, width * bounds.height / max(1, bounds.width))
    let image = page.thumbnail(of: NSSize(width: width, height: height), for: .mediaBox)
    guard let tiff = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiff),
          let png = bitmap.representation(using: .png, properties: [:]) else {
        continue
    }

    let imageURL = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("cowork-ocr-\(UUID().uuidString).png")
    try? png.write(to: imageURL)
    defer { try? FileManager.default.removeItem(at: imageURL) }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["en-US", "zh-Hans"]

    let handler = VNImageRequestHandler(url: imageURL, options: [:])
    do {
        try handler.perform([request])
    } catch {
        fputs("Vision OCR page \(pageIndex + 1) failed: \(error)\n", stderr)
        continue
    }

    for observation in request.results ?? [] {
        if let candidate = observation.topCandidates(1).first {
            print(candidate.string)
        }
    }
}
"#;

fn extract_pdf_form_text(doc: &lopdf::Document) -> String {
    let mut lines = Vec::new();

    if let Ok(catalog) = doc.catalog() {
        if let Ok(acro_form) = catalog.get_deref(b"AcroForm", doc).and_then(lopdf::Object::as_dict) {
            if let Ok(fields) = acro_form.get(b"Fields").and_then(lopdf::Object::as_array) {
                for field in fields {
                    collect_pdf_field(doc, field, None, &mut lines);
                }
            }
        }
    }

    for page_id in doc.get_pages().values().copied() {
        if let Ok(annotations) = doc.get_page_annotations(page_id) {
            for annotation in annotations {
                collect_pdf_field_dict(doc, annotation, None, &mut lines);
            }
        }
    }

    dedupe_lines(lines).join("\n")
}

fn collect_pdf_field(
    doc: &lopdf::Document,
    object: &lopdf::Object,
    inherited_name: Option<String>,
    lines: &mut Vec<String>,
) {
    let resolved = match object {
        lopdf::Object::Reference(id) => doc.get_object(*id).ok(),
        _ => Some(object),
    };
    if let Some(lopdf::Object::Dictionary(dict)) = resolved {
        collect_pdf_field_dict(doc, dict, inherited_name, lines);
    }
}

fn collect_pdf_field_dict(
    doc: &lopdf::Document,
    dict: &lopdf::Dictionary,
    inherited_name: Option<String>,
    lines: &mut Vec<String>,
) {
    let name = dict
        .get(b"T")
        .ok()
        .and_then(pdf_object_to_text)
        .or_else(|| dict.get(b"TU").ok().and_then(pdf_object_to_text))
        .or(inherited_name);

    let value = dict
        .get(b"V")
        .ok()
        .and_then(pdf_object_to_text)
        .or_else(|| dict.get(b"DV").ok().and_then(pdf_object_to_text));

    if let Some(value) = value.filter(|v| !v.trim().is_empty() && v.trim() != "Off") {
        if let Some(name) = name.as_ref().filter(|n| !n.trim().is_empty()) {
            lines.push(format!("{}: {}", name.trim(), value.trim()));
        } else {
            lines.push(value.trim().to_string());
        }
    }

    if let Ok(kids) = dict.get(b"Kids").and_then(lopdf::Object::as_array) {
        for kid in kids {
            collect_pdf_field(doc, kid, name.clone(), lines);
        }
    }
}

fn pdf_object_to_text(object: &lopdf::Object) -> Option<String> {
    match object {
        lopdf::Object::String(bytes, _) => Some(decode_pdf_string(bytes)),
        lopdf::Object::Name(bytes) => Some(String::from_utf8_lossy(bytes).to_string()),
        lopdf::Object::Integer(value) => Some(value.to_string()),
        lopdf::Object::Real(value) => Some(value.to_string()),
        lopdf::Object::Boolean(value) => Some(value.to_string()),
        lopdf::Object::Array(items) => {
            let values: Vec<String> = items.iter().filter_map(pdf_object_to_text).collect();
            if values.is_empty() { None } else { Some(values.join(", ")) }
        }
        _ => None,
    }
}

fn decode_pdf_string(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xFE, 0xFF]) && bytes.len() >= 4 {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|chunk| u16::from_be_bytes([chunk[0], chunk[1]]))
            .collect();
        return String::from_utf16_lossy(&units);
    }
    if bytes.starts_with(&[0xFF, 0xFE]) && bytes.len() >= 4 {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect();
        return String::from_utf16_lossy(&units);
    }
    String::from_utf8_lossy(bytes).to_string()
}

fn dedupe_lines(lines: Vec<String>) -> Vec<String> {
    let mut deduped = Vec::new();
    for line in lines {
        if !deduped.iter().any(|existing| existing == &line) {
            deduped.push(line);
        }
    }
    deduped
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

/// Delete a file if it exists.
#[tauri::command]
pub fn delete_file(path: &str) -> Result<(), String> {
    let file_path = Path::new(path);
    if !file_path.exists() {
        return Ok(());
    }
    if !file_path.is_file() {
        return Err(format!("Not a file: {}", path));
    }
    fs::remove_file(path).map_err(|e| format!("Failed to delete {}: {}", path, e))
}

/// Recursively delete a directory if it exists. Used by the skill uninstaller.
#[tauri::command]
pub fn delete_directory(path: &str) -> Result<(), String> {
    let dir_path = Path::new(path);
    if !dir_path.exists() {
        return Ok(());
    }
    if !dir_path.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }
    fs::remove_dir_all(path).map_err(|e| format!("Failed to delete {}: {}", path, e))
}

/// Read a local file and return its bytes encoded as base64. Used by tools that
/// need to embed file contents in JSON payloads (e.g. reference images for the
/// image generation API).
#[tauri::command]
pub fn read_file_base64(path: &str) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};
    let bytes = fs::read(path).map_err(|e| format!("Failed to read {}: {}", path, e))?;
    Ok(general_purpose::STANDARD.encode(bytes))
}

/// Download a URL and write the response body to `path`. Returns the saved
/// path. Parent directories are created if they don't exist.
#[tauri::command]
pub async fn download_url(url: String, path: String) -> Result<String, String> {
    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("Download request failed: {}", e))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Download failed with HTTP {}", status.as_u16()));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read download body: {}", e))?;
    let target = Path::new(&path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    fs::write(&path, &bytes).map_err(|e| format!("Failed to write {}: {}", path, e))?;
    Ok(path)
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

#[derive(Debug, Serialize)]
pub struct RipgrepMatch {
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
        .filter_entry(|e| {
            let n = e.file_name().to_string_lossy();
            e.depth() == 0 || (!n.starts_with('.') && !skip_dirs.contains(&n.as_ref()))
        })
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

/// Search file contents using ripgrep when available. The pattern is passed as
/// a single regex argument, not through a shell.
#[tauri::command]
pub fn ripgrep_search(
    directory: &str,
    pattern: &str,
    max_results: Option<u32>,
) -> Result<Vec<RipgrepMatch>, String> {
    let dir = Path::new(directory);
    if !dir.is_dir() { return Err(format!("Not a directory: {}", directory)); }
    if pattern.trim().is_empty() { return Ok(Vec::new()); }

    let max_u32 = max_results.unwrap_or(100).clamp(1, 1000);
    let output = Command::new("rg")
        .args([
            "--line-number",
            "--with-filename",
            "--ignore-case",
            "--color",
            "never",
            "--max-count",
            &max_u32.to_string(),
            pattern,
            directory,
        ])
        .output()
        .map_err(|e| format!("ripgrep is not available: {}", e))?;

    if !output.status.success() && output.status.code() != Some(1) {
        return Err(format!(
            "ripgrep failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let mut results = Vec::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        if results.len() >= max_u32 as usize { break; }
        if let Some((path, rest)) = line.split_once(':') {
            if let Some((line_number, text)) = rest.split_once(':') {
                if let Ok(line_number) = line_number.parse::<u32>() {
                    results.push(RipgrepMatch {
                        path: path.to_string(),
                        line_number,
                        line: text.to_string(),
                    });
                }
            }
        }
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::{extract_document_text_to_cache_impl, grep, parse_document, ripgrep_search, scan_directory_impl};
    use std::fs;
    use std::path::PathBuf;

    fn test_docs_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../test_docs")
    }

    fn test_doc(name: &str) -> String {
        test_docs_dir().join(name).to_string_lossy().to_string()
    }

    #[test]
    fn scan_directory_includes_real_test_docs_inventory() {
        let files = scan_directory_impl(&test_docs_dir().to_string_lossy()).expect("scan test_docs");
        let names: Vec<&str> = files.iter().map(|file| file.name.as_str()).collect();

        assert!(names.contains(&"25年上半年人力数据分析-V1.xlsx"));
        assert!(names.contains(&"硬件3月经营分析会.pdf"));
        assert!(names.contains(&"massistant-config.json"));
    }

    #[test]
    fn parse_document_extracts_real_xlsx_sheet_text() {
        let text = parse_document(&test_doc("25年上半年人力数据分析-V1.xlsx"))
            .expect("parse real xlsx sample");

        assert!(text.contains("## Sheet:"));
        assert!(text.trim().len() > 100);
    }

    #[test]
    fn extract_document_text_to_cache_writes_full_text_and_returns_preview() {
        let dir = std::env::temp_dir().join(format!("cowork-extract-cache-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create temp dir");
        let source = dir.join("source.md");
        let cache = dir.join(".cowork-text-cache/doc1.txt");
        let content = format!("{} searchable content", "a".repeat(1_500));
        fs::write(&source, &content).expect("write source");

        let result = extract_document_text_to_cache_impl(
            &source.to_string_lossy(),
            &cache.to_string_lossy(),
            Some(1_000),
        ).expect("extract to cache");

        assert_eq!(result.preview.len(), 1_000);
        assert_eq!(fs::read_to_string(&cache).expect("read cache"), content);
        assert!(result.char_count > result.preview.len());

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn parse_document_extracts_text_from_at_least_one_real_pdf_sample() {
        let pdfs = [
            "硬件3月经营分析会.pdf",
            "晚点访谈稿.pdf",
            "有道词典APP同传翻译重度用户定性报告 260305 V1.pdf",
            "KPMG_Studie_Artif_Intelligence_2018_BF_SEC_English.pdf",
        ];

        let parsed = pdfs
            .iter()
            .filter_map(|name| parse_document(&test_doc(name)).ok())
            .filter(|text| text.trim().len() > 100)
            .count();

        assert!(parsed > 0, "expected at least one real PDF sample to contain extractable text");
    }

    #[test]
    fn parse_document_extracts_real_pdf_form_fields() {
        if std::env::var("COWORK_RUN_OCR_TESTS").ok().as_deref() != Some("1") {
            eprintln!("Skipping OCR sample test; set COWORK_RUN_OCR_TESTS=1 to run it.");
            return;
        }

        let text = parse_document(&test_doc("ubs form 1.pdf"))
            .expect("parse real PDF form sample");

        assert!(text.trim().len() > 100);
    }

    #[test]
    fn grep_can_search_hidden_cache_when_it_is_the_root_directory() {
        let dir = std::env::temp_dir().join(format!(".cowork-text-cache-test-{}", std::process::id()));
        fs::create_dir_all(&dir).expect("create cache dir");
        let file = dir.join("doc1.txt");
        fs::write(&file, "alpha searchable keyword").expect("write cache file");

        let matches = grep(&dir.to_string_lossy(), "searchable", Some(10)).expect("grep cache dir");
        let _ = fs::remove_file(file);
        let _ = fs::remove_dir(dir);

        assert_eq!(matches.len(), 1);
        assert!(matches[0].line.contains("searchable"));
    }

    #[test]
    fn ripgrep_search_finds_or_regex_matches_when_available() {
        let dir = std::env::temp_dir().join(format!("cowork-rg-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create temp dir");
        let file = dir.join("doc1.txt");
        fs::write(&file, "人力资源\n招聘计划\n").expect("write temp file");

        match ripgrep_search(&dir.to_string_lossy(), "人力资源|薪酬", Some(10)) {
            Ok(matches) => assert!(matches.iter().any(|m| m.line.contains("人力资源"))),
            Err(err) if err.contains("ripgrep is not available") => {}
            Err(err) => panic!("unexpected ripgrep error: {}", err),
        }

        let _ = fs::remove_file(file);
        let _ = fs::remove_dir(dir);
    }
}

#[derive(Debug, Serialize)]
pub struct PythonResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

/// Execute Python script in the isolated environment.
/// Writes script to a temp file to avoid encoding issues with `-c` flag
/// (Chinese quotes, full-width chars, etc. break when passed as CLI args).
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

    // Write script to temp file to avoid encoding issues with -c flag
    let tmp_dir = home.join(".cowork/python/tmp");
    fs::create_dir_all(&tmp_dir).map_err(|e| format!("Failed to create tmp dir: {}", e))?;
    let script_path = tmp_dir.join(format!("script_{}.py", std::process::id()));
    fs::write(&script_path, script.as_bytes())
        .map_err(|e| format!("Failed to write script: {}", e))?;

    let duration = Duration::from_secs(timeout_secs.unwrap_or(30));
    let result = timeout(duration, async {
        let output = Command::new(venv_python.to_str().unwrap())
            .arg(script_path.to_str().unwrap())
            .env("PYTHONIOENCODING", "utf-8")
            .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped())
            .output().await.map_err(|e| format!("Failed to run Python: {}", e))?;
        Ok::<PythonResult, String>(PythonResult {
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code().unwrap_or(-1),
        })
    }).await.map_err(|_| format!("Python timed out after {}s", timeout_secs.unwrap_or(30)))?;

    // Clean up temp file
    let _ = fs::remove_file(&script_path);

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

/// Execute a Node.js script in the isolated environment.
/// Writes script to temp file, sets NODE_PATH so require() finds packages.
#[tauri::command]
pub async fn run_node_script(
    script: String,
    cwd: Option<String>,
    timeout_secs: Option<u64>,
) -> Result<PythonResult, String> {
    // Reuse PythonResult — same shape: stdout, stderr, exit_code
    use std::process::Stdio;
    use tokio::process::Command;
    use tokio::time::{timeout, Duration};

    let dir = node_env_dir()?;
    let node_modules = dir.join("node_modules");

    // Find node binary
    let expanded_path = super::mcp::expanded_path_str();

    // Write script to temp file (avoids encoding issues with -e flag)
    let tmp_dir = dir.join("tmp");
    fs::create_dir_all(&tmp_dir).map_err(|e| format!("Failed to create tmp dir: {}", e))?;
    let script_path = tmp_dir.join(format!("script_{}.js", std::process::id()));
    fs::write(&script_path, script.as_bytes())
        .map_err(|e| format!("Failed to write script: {}", e))?;

    let duration = Duration::from_secs(timeout_secs.unwrap_or(30));
    let work_dir = cwd.unwrap_or_else(|| {
        dirs_next::home_dir()
            .map(|h| h.to_string_lossy().to_string())
            .unwrap_or_else(|| "/tmp".to_string())
    });

    let result = timeout(duration, async {
        let output = Command::new("node")
            .arg(script_path.to_str().unwrap())
            .current_dir(&work_dir)
            .env("PATH", &expanded_path)
            .env("NODE_PATH", node_modules.to_str().unwrap())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| format!("Failed to run Node: {}", e))?;
        Ok::<PythonResult, String>(PythonResult {
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code().unwrap_or(-1),
        })
    })
    .await
    .map_err(|_| format!("Node timed out after {}s", timeout_secs.unwrap_or(30)))?;

    // Clean up temp file
    let _ = fs::remove_file(&script_path);

    result
}
