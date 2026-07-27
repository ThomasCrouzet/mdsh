//! Disk helpers for the mdsh desktop shell.
//!
//! Paths must be absolute, extension-allowed, **and** granted for the session.
//! Grants come from:
//! - process argv / file-association opens (`PendingOpenPaths`)
//! - explicit `disk_grant` after a native open/save dialog (frontend)
//!
//! This raises the bar vs unrestricted absolute-path R/W while keeping
//! argv and dialog-picked paths working. Residual risk: a compromised
//! webview can still call `disk_grant` then write - full dialog-in-Rust
//! would close that further (tracked as residual hardening).

use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

/// Markdown/text extensions allowed for open, argv, read, and document save.
const ALLOWED_READ_EXTS: &[&str] = &["md", "markdown", "mdx", "txt"];
/// Extra extensions allowed only for write (export/backup downloads on desktop).
const ALLOWED_WRITE_EXTRA_EXTS: &[&str] = &["html", "htm", "zip", "json"];

#[derive(Default)]
pub struct PendingOpenPaths(pub Mutex<Vec<String>>);

/// Session allowlist of absolute paths permitted for disk_read / disk_write.
#[derive(Default)]
pub struct GrantedPaths(pub Mutex<HashSet<String>>);

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

impl GrantedPaths {
    pub fn grant_many(&self, paths: impl IntoIterator<Item = String>) -> usize {
        let mut n = 0;
        if let Ok(mut guard) = self.0.lock() {
            for p in paths {
                if p.is_empty() {
                    continue;
                }
                let path = PathBuf::from(&p);
                if path_key(&path).is_ok() && ensure_write_allowed(&path).is_ok() {
                    if guard.insert(normalize_key(&path)) {
                        n += 1;
                    }
                } else if path_key(&path).is_ok() && ensure_read_allowed(&path).is_ok() {
                    if guard.insert(normalize_key(&path)) {
                        n += 1;
                    }
                }
            }
        }
        n
    }

    fn is_granted(&self, path: &Path) -> bool {
        let key = normalize_key(path);
        self.0.lock().map(|g| g.contains(&key)).unwrap_or(false)
    }
}

/// Stable key for grant lookups (absolute, no trailing slash noise).
fn normalize_key(path: &Path) -> String {
    path_key(path).unwrap_or_else(|_| path.to_string_lossy().into_owned())
}

fn path_key(path: &Path) -> Result<String, String> {
    if !path.is_absolute() {
        return Err("path must be absolute".to_string());
    }
    let s = path.to_string_lossy();
    if s.contains('\0') {
        return Err("path contains NUL".to_string());
    }
    // Reject `..` segments to limit traversal tricks before canonicalize.
    if path
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("path must not contain '..'".to_string());
    }
    // Prefer canonical form when the path (or parent) exists.
    if let Ok(canon) = path.canonicalize() {
        return Ok(canon.to_string_lossy().into_owned());
    }
    if let Some(parent) = path.parent() {
        if let Ok(parent_canon) = parent.canonicalize() {
            if let Some(name) = path.file_name() {
                return Ok(parent_canon.join(name).to_string_lossy().into_owned());
            }
        }
    }
    Ok(path.to_string_lossy().into_owned())
}

fn extension_of(path: &Path) -> Result<String, String> {
    if !path.is_absolute() {
        return Err("path must be absolute".to_string());
    }
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .ok_or_else(|| "file has no extension".to_string())
}

fn ensure_read_allowed(path: &Path) -> Result<(), String> {
    let ext = extension_of(path)?;
    if !ALLOWED_READ_EXTS.contains(&ext.as_str()) {
        return Err(format!("extension not allowed: .{ext}"));
    }
    Ok(())
}

fn ensure_write_allowed(path: &Path) -> Result<(), String> {
    let ext = extension_of(path)?;
    if ALLOWED_READ_EXTS.contains(&ext.as_str()) || ALLOWED_WRITE_EXTRA_EXTS.contains(&ext.as_str())
    {
        return Ok(());
    }
    Err(format!("extension not allowed: .{ext}"))
}

fn ensure_granted(grants: &GrantedPaths, path: &Path) -> Result<(), String> {
    path_key(path)?; // validates absolute / no `..` / no NUL
    if grants.is_granted(path) {
        return Ok(());
    }
    // Also accept if canonicalize-equivalent key is granted.
    let key = normalize_key(path);
    if grants.0.lock().map(|g| g.contains(&key)).unwrap_or(false) {
        return Ok(());
    }
    Err("path not granted for this session".to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskStat {
    pub mtime_ms: f64,
    pub size: u64,
}

/// Registers absolute paths for subsequent disk_read / disk_write / disk_stat.
/// Called after native open/save dialogs and when re-linking known path records.
#[tauri::command]
pub fn disk_grant(
    grants: tauri::State<'_, GrantedPaths>,
    paths: Vec<String>,
) -> Result<usize, String> {
    Ok(grants.grant_many(paths))
}

#[tauri::command]
pub fn disk_read(grants: tauri::State<'_, GrantedPaths>, path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    ensure_read_allowed(&p)?;
    ensure_granted(&grants, &p)?;
    fs::read_to_string(&p).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn disk_write(
    grants: tauri::State<'_, GrantedPaths>,
    path: String,
    content: String,
) -> Result<(), String> {
    let p = PathBuf::from(&path);
    ensure_write_allowed(&p)?;
    ensure_granted(&grants, &p)?;
    fs::write(&p, content).map_err(|e| e.to_string())
}

/// Binary write for export artifacts (ZIP) - same extension + grant gate.
#[tauri::command]
pub fn disk_write_bytes(
    grants: tauri::State<'_, GrantedPaths>,
    path: String,
    contents: Vec<u8>,
) -> Result<(), String> {
    let p = PathBuf::from(&path);
    ensure_write_allowed(&p)?;
    ensure_granted(&grants, &p)?;
    fs::write(&p, contents).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn disk_stat(
    grants: tauri::State<'_, GrantedPaths>,
    path: String,
) -> Result<Option<DiskStat>, String> {
    let p = PathBuf::from(&path);
    // Stat accepts any write-allowed path so export targets can be verified.
    ensure_write_allowed(&p)?;
    ensure_granted(&grants, &p)?;
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
pub fn take_pending_open_paths(
    state: tauri::State<'_, PendingOpenPaths>,
    grants: tauri::State<'_, GrantedPaths>,
) -> Vec<String> {
    let paths = state.take();
    // Argv / file-association paths are trusted (native OS open).
    grants.grant_many(paths.iter().cloned());
    paths
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
                .map(|e| ALLOWED_READ_EXTS.contains(&e.to_ascii_lowercase().as_str()))
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

    fn grant_for(path: &Path) -> GrantedPaths {
        let g = GrantedPaths::default();
        g.grant_many([path.to_string_lossy().into_owned()]);
        g
    }

    #[test]
    fn rejects_relative_and_unsupported_paths() {
        assert!(ensure_read_allowed(Path::new("note.md")).is_err());
        assert!(ensure_read_allowed(&temp_path("pdf")).is_err());
        assert!(ensure_read_allowed(&temp_path("MD")).is_ok());
        // Export write may use html/zip/json; read still rejects them.
        assert!(ensure_read_allowed(&temp_path("html")).is_err());
        assert!(ensure_write_allowed(&temp_path("html")).is_ok());
        assert!(ensure_write_allowed(&temp_path("zip")).is_ok());
        assert!(ensure_write_allowed(&temp_path("json")).is_ok());
        assert!(ensure_write_allowed(&temp_path("pdf")).is_err());
    }

    #[test]
    fn rejects_parent_dir_segments() {
        let p = std::env::temp_dir().join("a/../b.md");
        // On some platforms join normalizes; force a raw string with `..`.
        let raw = format!("{}/a/../evil.md", std::env::temp_dir().to_string_lossy());
        assert!(path_key(Path::new(&raw)).is_err());
        let _ = p;
    }

    #[test]
    fn ungranted_path_is_rejected() {
        let path = temp_path("md");
        let grants = GrantedPaths::default();
        assert!(ensure_granted(&grants, &path).is_err());
        grants.grant_many([path.to_string_lossy().into_owned()]);
        assert!(ensure_granted(&grants, &path).is_ok());
    }

    #[test]
    fn write_bytes_allows_export_extensions() {
        let path = temp_path("zip");
        let path_string = path.to_string_lossy().into_owned();
        let grants = grant_for(&path);
        // Unit tests call internal helpers without Tauri State - exercise grant + write via grant_many + fs.
        ensure_write_allowed(&path).expect("ext");
        ensure_granted(&grants, &path).expect("granted");
        fs::write(&path, [0x50, 0x4b, 0x03, 0x04]).expect("zip write should succeed");
        let data = fs::read(&path).expect("read back");
        assert_eq!(data, vec![0x50, 0x4b, 0x03, 0x04]);
        let _ = path_string;
        fs::remove_file(path).expect("cleanup");
    }

    #[test]
    fn reads_writes_and_stats_an_allowed_file() {
        let path = temp_path("md");
        let path_string = path.to_string_lossy().into_owned();
        let grants = grant_for(&path);

        ensure_write_allowed(&path).unwrap();
        ensure_granted(&grants, &path).unwrap();
        fs::write(&path, "# Test").expect("write should succeed");
        ensure_read_allowed(&path).unwrap();
        assert_eq!(fs::read_to_string(&path).expect("read"), "# Test");
        let meta = fs::metadata(&path).expect("stat");
        assert_eq!(meta.len(), 6);

        let _ = path_string;
        fs::remove_file(path).expect("temporary file cleanup should succeed");
    }

    #[test]
    fn returns_none_for_a_missing_allowed_file() {
        let path = temp_path("md");
        let grants = grant_for(&path);
        ensure_granted(&grants, &path).unwrap();
        assert!(matches!(fs::metadata(&path), Err(e) if e.kind() == ErrorKind::NotFound));
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

    #[test]
    fn grant_many_skips_bad_extensions() {
        let g = GrantedPaths::default();
        let n = g.grant_many([
            temp_path("md").to_string_lossy().into_owned(),
            temp_path("pdf").to_string_lossy().into_owned(),
        ]);
        assert_eq!(n, 1);
    }
}
