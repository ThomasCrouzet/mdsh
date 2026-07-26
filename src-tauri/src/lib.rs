mod disk;

use disk::{collect_argv_paths, PendingOpenPaths};
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pending = PendingOpenPaths::default();
    pending.push_many(collect_argv_paths());

    tauri::Builder::default()
        .manage(pending)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            disk::disk_read,
            disk::disk_write,
            disk::disk_stat,
            disk::take_pending_open_paths,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if let tauri::RunEvent::Opened { urls } = event {
                let paths: Vec<String> = urls
                    .into_iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();
                if paths.is_empty() {
                    return;
                }
                if let Some(state) = app_handle.try_state::<PendingOpenPaths>() {
                    state.push_many(paths.clone());
                }
                let _ = app_handle.emit("mdsh://open-paths", paths);
            }
            // Suppress unused warning on non-macOS where Opened is not matched.
            #[cfg(not(any(target_os = "macos", target_os = "ios")))]
            {
                let _ = (app_handle, event);
            }
        });
}
