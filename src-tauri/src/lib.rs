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
            commands::fs::write_file,
            commands::fs::list_directory,
            commands::fs::grep,
            commands::fs::run_python_script,
            commands::fs::init_python_env,
            commands::fs::install_python_package,
            commands::fs::init_node_env,
            commands::fs::install_node_package,
            commands::fs::get_node_path,
            commands::fs::run_node_script,
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
