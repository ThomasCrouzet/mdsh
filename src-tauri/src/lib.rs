mod disk;
mod shell;

use disk::{collect_argv_paths, collect_paths_from_directory, CapabilityStore, PendingOpenPaths};
use tauri::{Emitter, Manager};

fn queue_open_paths(app: &tauri::AppHandle, paths: Vec<String>) {
    let paths = collect_paths_from_directory(paths, None);
    if paths.is_empty() {
        return;
    }
    app.state::<PendingOpenPaths>().push_many(paths);
    let _ = app.emit("mdsh://open-paths-pending", ());
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pending = PendingOpenPaths::default();
    let argv = collect_argv_paths();
    pending.push_many(argv);

    let builder =
        tauri::Builder::default().plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            queue_open_paths(
                app,
                collect_paths_from_directory(
                    args.into_iter().skip(1),
                    Some(std::path::Path::new(&cwd)),
                ),
            );
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    #[cfg(feature = "native-smoke")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .manage(pending)
        .manage(CapabilityStore::default())
        .manage(shell::CloseState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri::plugin::Builder::<_, ()>::new("navigation-policy")
                .on_navigation(|_, url| shell::allowed_navigation(url, cfg!(debug_assertions)))
                .build(),
        )
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            disk::disk_read,
            disk::disk_write,
            disk::disk_write_bytes,
            disk::disk_stat,
            disk::disk_open_dialog,
            disk::disk_open_directory,
            disk::disk_save_dialog,
            disk::take_pending_open_paths,
            disk::ack_pending_open_paths,
            shell::desktop_open_external,
            shell::desktop_arm_close_guard,
            shell::desktop_ack_close_request,
            shell::desktop_complete_close,
            shell::desktop_smoke_request_close,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            match &event {
                tauri::RunEvent::WindowEvent {
                    label,
                    event: tauri::WindowEvent::CloseRequested { api, .. },
                    ..
                } if label == "main" => {
                    if shell::request_close(app_handle) {
                        api.prevent_close();
                    }
                }
                tauri::RunEvent::ExitRequested { api, .. } if shell::request_close(app_handle) => {
                    api.prevent_exit();
                }
                _ => {}
            }
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if let tauri::RunEvent::Opened { urls } = event {
                let paths: Vec<String> = urls
                    .into_iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();
                queue_open_paths(app_handle, paths);
            }
        });
}
