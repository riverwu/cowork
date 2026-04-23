mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::fs::scan_directory,
            commands::fs::read_file_text,
            commands::fs::parse_document,
            commands::env::get_env,
            commands::http::http_post,
            commands::http::http_stream_post,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
