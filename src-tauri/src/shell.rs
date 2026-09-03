use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tauri::{Emitter, Manager, Url};
use tauri_plugin_opener::OpenerExt;

#[derive(Default)]
pub struct CloseState {
    armed: AtomicBool,
    approved: AtomicBool,
    next_request: AtomicU64,
    pending_request: AtomicU64,
}

impl CloseState {
    pub fn should_wait(&self) -> bool {
        self.armed.load(Ordering::SeqCst) && !self.approved.load(Ordering::SeqCst)
    }

    fn arm(&self) -> Option<u64> {
        self.armed.store(true, Ordering::SeqCst);
        let pending = self.pending_request.load(Ordering::SeqCst);
        (pending != 0).then_some(pending)
    }

    fn request(&self) -> Option<u64> {
        if !self.should_wait() {
            return None;
        }
        let request_id = self.next_request.fetch_add(1, Ordering::SeqCst) + 1;
        self.pending_request.store(request_id, Ordering::SeqCst);
        Some(request_id)
    }

    fn acknowledge(&self, request_id: u64) {
        // Un accusé tardif ne doit pas effacer une demande plus récente.
        let _ = self.pending_request.compare_exchange(
            request_id,
            0,
            Ordering::SeqCst,
            Ordering::SeqCst,
        );
    }
}

pub fn allowed_navigation(url: &Url, development: bool) -> bool {
    match (url.scheme(), url.host_str()) {
        ("tauri", Some("localhost")) => true,
        ("http" | "https", Some("tauri.localhost")) => true,
        ("http", Some("localhost" | "127.0.0.1")) if development => {
            url.port_or_known_default() == Some(5173)
        }
        _ => false,
    }
}

fn external_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|error| error.to_string())?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("external links must use HTTP or HTTPS without credentials".to_string());
    }
    Ok(url)
}

#[tauri::command]
pub fn desktop_open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let url = external_url(&url)?;
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn desktop_arm_close_guard(app: tauri::AppHandle, state: tauri::State<'_, CloseState>) {
    // Le frontend s'abonne avant cet appel. Une demande perdue pendant son
    // rechargement reste disponible jusqu'à son accusé de réception explicite.
    if let Some(request_id) = state.arm() {
        let _ = app.emit("mdsh://close-request", request_id);
    }
}

#[tauri::command]
pub fn desktop_ack_close_request(state: tauri::State<'_, CloseState>, request_id: u64) {
    state.acknowledge(request_id);
}

#[tauri::command]
pub fn desktop_complete_close(app: tauri::AppHandle, state: tauri::State<'_, CloseState>) {
    state.approved.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[tauri::command]
pub fn desktop_smoke_request_close(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(feature = "native-smoke")]
    {
        app.get_webview_window("main")
            .ok_or_else(|| "main window unavailable".to_string())?
            .close()
            .map_err(|error| error.to_string())
    }
    #[cfg(not(feature = "native-smoke"))]
    {
        let _ = app;
        Err("test command unavailable".to_string())
    }
}

pub fn request_close(app: &tauri::AppHandle) -> bool {
    let Some(request_id) = app.state::<CloseState>().request() else {
        return false;
    };
    let _ = app.emit("mdsh://close-request", request_id);
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn navigation_stays_inside_the_app_origin() {
        assert!(allowed_navigation(
            &Url::parse("tauri://localhost/").unwrap(),
            false
        ));
        assert!(allowed_navigation(
            &Url::parse("http://tauri.localhost/").unwrap(),
            false
        ));
        assert!(allowed_navigation(
            &Url::parse("http://localhost:5173/").unwrap(),
            true
        ));
        assert!(!allowed_navigation(
            &Url::parse("http://localhost:5173/").unwrap(),
            false
        ));
        assert!(!allowed_navigation(
            &Url::parse("https://example.com/").unwrap(),
            true
        ));
        assert!(!allowed_navigation(
            &Url::parse("file:///tmp/private.md").unwrap(),
            false
        ));
    }

    #[test]
    fn external_opener_rejects_files_scripts_and_credentials() {
        assert!(external_url("https://example.com/doc").is_ok());
        assert!(external_url("http://example.com/doc").is_ok());
        assert!(external_url("file:///tmp/private.md").is_err());
        assert!(external_url("javascript:alert(1)").is_err());
        assert!(external_url("https://user:secret@example.com/").is_err());
        assert!(external_url("/relative").is_err());
    }

    #[test]
    fn close_guard_waits_only_after_the_frontend_is_ready() {
        let state = CloseState::default();
        assert!(!state.should_wait());
        assert_eq!(state.request(), None);
        assert_eq!(state.arm(), None);
        assert!(state.should_wait());
        state.approved.store(true, Ordering::SeqCst);
        assert!(!state.should_wait());
        assert_eq!(state.request(), None);
    }

    #[test]
    fn close_lost_during_reload_is_replayed_until_received() {
        let state = CloseState::default();
        state.arm();
        let request_id = state.request().unwrap();
        assert_eq!(state.arm(), Some(request_id));
        state.acknowledge(request_id);
        assert_eq!(state.arm(), None);
    }

    #[test]
    fn received_close_does_not_reappear_after_a_failed_save() {
        let state = CloseState::default();
        state.arm();
        let request_id = state.request().unwrap();
        state.acknowledge(request_id);
        assert!(state.should_wait());
        assert_eq!(state.arm(), None);
        assert!(state.request().unwrap() > request_id);
    }

    #[test]
    fn stale_and_duplicate_receipts_preserve_newer_close_requests() {
        let state = CloseState::default();
        state.arm();
        let first = state.request().unwrap();
        let second = state.request().unwrap();
        state.acknowledge(first);
        assert_eq!(state.arm(), Some(second));
        state.acknowledge(second);
        state.acknowledge(second);
        assert_eq!(state.arm(), None);
    }
}
