//! Disk helpers for the mdsh desktop shell.
//! Extension-gated read/write so argv / file-association opens work without
//! relying solely on dialog-granted fs scopes.

use serde::Serialize;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

const ALLOWED_EXTS: &[&str] = &["md", "markdown", "mdx", "txt"];

#[derive(Default)]
pub struct PendingOpenPaths(pub Mutex<Vec<String>>);

impl PendingOpenPaths {
    pub fn push_many(&self, paths: impl IntoIterator<Item = String>) {
        if let Ok(mut guard) = self.0.lock() {
            for p in paths {
                if !p.is_empty() && !guard.iter().any(|x| x == &p) {
                    guard.push(p);
                }
            }
        }
    }

    pub fn take(&self) -> Vec<String> {
        self.0
            .lock()
            .map(|mut g| std::mem::take(&mut *g))
            .unwrap_or_default()
    }
}

fn ensure_allowed(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("path must be absolute".to_string());
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .ok_or_else(|| "file has no extension".to_string())?;
    if !ALLOWED_EXTS.contains(&ext.as_str()) {
        return Err(format!("extension not allowed: .{ext}"));
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskStat {
    pub mtime_ms: f64,
    pub size: u64,
}

#[tauri::command]
pub fn disk_read(path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    ensure_allowed(&p)?;
    fs::read_to_string(&p).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn disk_write(path: String, content: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    ensure_allowed(&p)?;
    fs::write(&p, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn disk_stat(path: String) -> Result<Option<DiskStat>, String> {
    let p = PathBuf::from(&path);
    ensure_allowed(&p)?;
    let meta = match fs::metadata(&p) {
        Ok(m) => m,
        Err(err) if err.kind() == ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(err.to_string()),
    };
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0);
    Ok(Some(DiskStat {
        mtime_ms,
        size: meta.len(),
    }))
}

#[tauri::command]
pub fn take_pending_open_paths(state: tauri::State<'_, PendingOpenPaths>) -> Vec<String> {
    state.take()
}

/// Collect markdown paths from process argv (skip binary path).
pub fn collect_argv_paths() -> Vec<String> {
    std::env::args()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .filter_map(|a| {
            let path = PathBuf::from(a);
            let allowed = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| ALLOWED_EXTS.contains(&e.to_ascii_lowercase().as_str()))
                .unwrap_or(false);
            if !allowed {
                return None;
            }
            path.canonicalize()
                .ok()
                .map(|canonical| canonical.to_string_lossy().into_owned())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_path(extension: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before Unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "mdsh-disk-{}-{nonce}.{extension}",
            std::process::id()
        ))
    }

    #[test]
    fn rejects_relative_and_unsupported_paths() {
        assert!(ensure_allowed(Path::new("note.md")).is_err());
        assert!(ensure_allowed(&temp_path("pdf")).is_err());
        assert!(ensure_allowed(&temp_path("MD")).is_ok());
    }

    #[test]
    fn reads_writes_and_stats_an_allowed_file() {
        let path = temp_path("md");
        let path_string = path.to_string_lossy().into_owned();

        disk_write(path_string.clone(), "# Test".to_string()).expect("write should succeed");
        assert_eq!(
            disk_read(path_string.clone()).expect("read should succeed"),
            "# Test"
        );
        let stat = disk_stat(path_string)
            .expect("stat should succeed")
            .expect("file should exist");
        assert_eq!(stat.size, 6);

        fs::remove_file(path).expect("temporary file cleanup should succeed");
    }

    #[test]
    fn returns_none_for_a_missing_allowed_file() {
        let path = temp_path("md").to_string_lossy().into_owned();
        assert!(disk_stat(path).expect("stat should not fail").is_none());
    }

    #[test]
    fn pending_paths_are_deduplicated_and_drained() {
        let pending = PendingOpenPaths::default();
        pending.push_many([
            "/tmp/a.md".to_string(),
            "/tmp/a.md".to_string(),
            String::new(),
        ]);

        assert_eq!(pending.take(), vec!["/tmp/a.md"]);
        assert!(pending.take().is_empty());
    }
}
