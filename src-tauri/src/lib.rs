mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::fs::open_path,
            commands::fs::reveal_in_folder,
            commands::fs::scan_directory,
            commands::fs::read_file_text,
            commands::fs::parse_document,
            commands::fs::extract_document_text_to_cache,
            commands::fs::start_knowledge_index,
            commands::fs::write_file,
            commands::fs::delete_file,
            commands::fs::delete_directory,
            commands::fs::read_file_base64,
            commands::fs::download_url,
            commands::fs::list_directory,
            commands::fs::grep,
            commands::fs::ripgrep_search,
            commands::fs::run_python_script,
            commands::fs::init_python_env,
            commands::fs::install_python_package,
            commands::fs::init_node_env,
            commands::fs::install_node_package,
            commands::fs::get_node_path,
            commands::fs::run_node_script,
            commands::fs::slideml_compile,
            commands::fs::slideml_list_layouts,
            commands::fs::slideml_describe_layout,
            commands::fs::slideml_validate,
            commands::fs::slideml_edit,
            commands::fs::slideml_audit,
            commands::fs::slideml_list_themes,
            commands::env::get_env,
            commands::http::http_post,
            commands::http::http_stream_post,
            commands::mcp::mcp_spawn,
            commands::mcp::mcp_send,
            commands::mcp::mcp_stop,
            commands::mcp::mcp_list,
            commands::mcp::ensure_uv_installed,
            commands::web::web_fetch,
            commands::web::web_search,
            commands::shell::shell_exec,
            commands::shell::shell_exec_stream,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // On macOS, Tauri keeps the app alive after the last window closes.
            // Cowork is single-window: when its window goes away, exit the app
            // through the standard lifecycle so plugins and resources clean up.
            if let tauri::RunEvent::WindowEvent {
                event: tauri::WindowEvent::Destroyed,
                ..
            } = event
            {
                app_handle.exit(0);
            }
        });
}
