use std::env;

/// Read an environment variable. Returns None if not set.
#[tauri::command]
pub fn get_env(key: &str) -> Option<String> {
    env::var(key).ok()
}
