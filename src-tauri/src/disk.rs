//! Native disk boundary for the desktop shell.
//!
//! The webview never grants paths. Native dialogs, process arguments and OS
//! file-open events create opaque, session-scoped capabilities. Every read,
//! stat and write command accepts only a capability token.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{ErrorKind, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

const ALLOWED_READ_EXTS: &[&str] = &["md", "markdown", "mdx", "txt"];
const ALLOWED_WRITE_EXTRA_EXTS: &[&str] = &["html", "htm", "zip", "json"];

#[derive(Default)]
pub struct PendingOpenPaths(pub Mutex<Vec<String>>);

#[derive(Clone)]
struct Capability {
    path: PathBuf,
    can_write: bool,
}

#[derive(Default)]
pub struct CapabilityStore(Mutex<HashMap<String, Capability>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskStat {
    pub mtime_ms: f64,
    pub size: u64,
    pub revision: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskGrant {
    pub token: String,
    pub path: String,
    pub stat: Option<DiskStat>,
}

impl PendingOpenPaths {
    pub fn push_many(&self, paths: impl IntoIterator<Item = String>) {
        if let Ok(mut guard) = self.0.lock() {
            for path in paths {
                if !path.is_empty() && !guard.iter().any(|known| known == &path) {
                    guard.push(path);
                }
            }
        }
    }

    pub fn take(&self) -> Vec<String> {
        self.0
            .lock()
            .map(|mut guard| std::mem::take(&mut *guard))
            .unwrap_or_default()
    }
}

impl CapabilityStore {
    pub fn grant_native_path(&self, path: &Path, can_write: bool) -> Result<DiskGrant, String> {
        let normalized = path_key(path)?;
        if can_write {
            ensure_write_allowed(&normalized)?;
        } else {
            ensure_read_allowed(&normalized)?;
        }
        reject_symlink(&normalized)?;
        let token = Uuid::new_v4().to_string();
        let stat = stat_path(&normalized)?;
        self.0
            .lock()
            .map_err(|_| "capability store unavailable".to_string())?
            .insert(
                token.clone(),
                Capability {
                    path: normalized.clone(),
                    can_write,
                },
            );
        Ok(DiskGrant {
            token,
            path: normalized.to_string_lossy().into_owned(),
            stat,
        })
    }

    fn resolve(&self, token: &str, write: bool) -> Result<PathBuf, String> {
        let capability = self
            .0
            .lock()
            .map_err(|_| "capability store unavailable".to_string())?
            .get(token)
            .cloned()
            .ok_or_else(|| "invalid or expired disk capability".to_string())?;
        if write && !capability.can_write {
            return Err("disk capability is read-only".to_string());
        }
        reject_symlink(&capability.path)?;
        Ok(capability.path)
    }
}

fn path_key(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("path must be absolute".to_string());
    }
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("path must not contain '..'".to_string());
    }
    reject_symlink(path)?;
    if let Ok(canonical) = path.canonicalize() {
        return Ok(canonical);
    }
    let parent = path
        .parent()
        .ok_or_else(|| "path has no parent".to_string())?
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let name = path
        .file_name()
        .ok_or_else(|| "path has no filename".to_string())?;
    Ok(parent.join(name))
}

fn extension_of(path: &Path) -> Result<String, String> {
    if !path.is_absolute() {
        return Err("path must be absolute".to_string());
    }
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .ok_or_else(|| "file has no extension".to_string())
}

fn ensure_read_allowed(path: &Path) -> Result<(), String> {
    let extension = extension_of(path)?;
    if ALLOWED_READ_EXTS.contains(&extension.as_str()) {
        Ok(())
    } else {
        Err(format!("extension not allowed: .{extension}"))
    }
}

fn ensure_write_allowed(path: &Path) -> Result<(), String> {
    let extension = extension_of(path)?;
    if ALLOWED_READ_EXTS.contains(&extension.as_str())
        || ALLOWED_WRITE_EXTRA_EXTS.contains(&extension.as_str())
    {
        Ok(())
    } else {
        Err(format!("extension not allowed: .{extension}"))
    }
}

fn reject_symlink(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err("symbolic-link targets are not accepted".to_string())
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn revision_for(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("sha256:{:x}", hasher.finalize()))
}

fn stat_path(path: &Path) -> Result<Option<DiskStat>, String> {
    reject_symlink(path)?;
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    if !metadata.is_file() {
        return Err("disk target is not a regular file".to_string());
    }
    let mtime_ms = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs_f64() * 1000.0)
        .unwrap_or(0.0);
    Ok(Some(DiskStat {
        mtime_ms,
        size: metadata.len(),
        revision: revision_for(path)?,
    }))
}

fn ensure_expected_revision(
    path: &Path,
    expected_revision: Option<&str>,
    force: bool,
) -> Result<(), String> {
    if force {
        return Ok(());
    }
    let current = stat_path(path)?.map(|stat| stat.revision);
    match (expected_revision, current.as_deref()) {
        (Some(expected), Some(actual)) if expected == actual => Ok(()),
        (None, None) => Ok(()),
        _ => Err("disk conflict: target changed since it was opened".to_string()),
    }
}

fn temporary_path(path: &Path) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .ok_or_else(|| "disk target has no parent".to_string())?;
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "disk target filename is invalid".to_string())?;
    Ok(parent.join(format!(".{filename}.{}.tmp", Uuid::new_v4())))
}

#[cfg(unix)]
fn replace_file(temp: &Path, target: &Path) -> Result<(), String> {
    fs::rename(temp, target).map_err(|error| error.to_string())?;
    if let Some(parent) = target.parent() {
        File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(windows)]
fn replace_file(temp: &Path, target: &Path) -> Result<(), String> {
    if !target.exists() {
        return fs::rename(temp, target).map_err(|error| error.to_string());
    }
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::ReplaceFileW;
    let target_wide: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    let temp_wide: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
    let result = unsafe {
        ReplaceFileW(
            target_wide.as_ptr(),
            temp_wide.as_ptr(),
            std::ptr::null(),
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error().to_string())
    } else {
        Ok(())
    }
}

fn atomic_write(
    path: &Path,
    contents: &[u8],
    expected_revision: Option<&str>,
    force: bool,
) -> Result<DiskStat, String> {
    ensure_write_allowed(path)?;
    reject_symlink(path)?;
    let temp = temporary_path(path)?;
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|error| error.to_string())?;
        if let Ok(metadata) = fs::metadata(path) {
            fs::set_permissions(&temp, metadata.permissions())
                .map_err(|error| error.to_string())?;
        }
        file.write_all(contents)
            .map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        // This is the final operation before same-directory replacement.
        ensure_expected_revision(path, expected_revision, force)?;
        replace_file(&temp, path)?;
        stat_path(path)?.ok_or_else(|| "written file disappeared".to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn read_capability(
    capabilities: &CapabilityStore,
    token: &str,
) -> Result<(PathBuf, String), String> {
    let path = capabilities.resolve(token, false)?;
    ensure_read_allowed(&path)?;
    let content = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    Ok((path, content))
}

fn normalize_save_extension(mut path: PathBuf, suggested_name: &str, export: bool) -> PathBuf {
    if extension_of(&path)
        .and_then(|_| ensure_write_allowed(&path))
        .is_ok()
    {
        return path;
    }
    let fallback = if export {
        Path::new(suggested_name)
            .extension()
            .and_then(|extension| extension.to_str())
            .filter(|extension| {
                ALLOWED_READ_EXTS.contains(&extension.to_ascii_lowercase().as_str())
                    || ALLOWED_WRITE_EXTRA_EXTS.contains(&extension.to_ascii_lowercase().as_str())
            })
            .unwrap_or("md")
            .to_string()
    } else {
        "md".to_string()
    };
    path.set_extension(fallback);
    path
}

fn grant_save_selection(
    capabilities: &CapabilityStore,
    selected: Option<PathBuf>,
    suggested_name: &str,
    export: bool,
) -> Result<Option<DiskGrant>, String> {
    let Some(path) = selected else {
        return Ok(None);
    };
    let path = normalize_save_extension(path, suggested_name, export);
    capabilities.grant_native_path(&path, true).map(Some)
}

#[tauri::command]
pub fn disk_open_dialog(
    app: tauri::AppHandle,
    capabilities: tauri::State<'_, CapabilityStore>,
    multiple: bool,
) -> Result<Vec<DiskGrant>, String> {
    let builder = app
        .dialog()
        .file()
        .add_filter("Markdown and text", ALLOWED_READ_EXTS);
    let selected = if multiple {
        builder.blocking_pick_files().unwrap_or_default()
    } else {
        builder.blocking_pick_file().into_iter().collect()
    };
    selected
        .into_iter()
        .map(|file_path| {
            let path = file_path.into_path().map_err(|error| error.to_string())?;
            capabilities.grant_native_path(&path, true)
        })
        .collect()
}

#[tauri::command]
pub fn disk_save_dialog(
    app: tauri::AppHandle,
    capabilities: tauri::State<'_, CapabilityStore>,
    suggested_name: String,
    export: bool,
) -> Result<Option<DiskGrant>, String> {
    let extensions: &[&str] = if export {
        &["md", "markdown", "mdx", "txt", "html", "htm", "zip", "json"]
    } else {
        ALLOWED_READ_EXTS
    };
    let selected = app
        .dialog()
        .file()
        .add_filter("Supported files", extensions)
        .set_file_name(&suggested_name)
        .blocking_save_file();
    let selected = selected
        .map(|file_path| file_path.into_path().map_err(|error| error.to_string()))
        .transpose()?;
    grant_save_selection(&capabilities, selected, &suggested_name, export)
}

#[tauri::command]
pub fn disk_read(
    capabilities: tauri::State<'_, CapabilityStore>,
    token: String,
) -> Result<String, String> {
    read_capability(&capabilities, &token).map(|(_, content)| content)
}

#[tauri::command]
pub fn disk_write(
    capabilities: tauri::State<'_, CapabilityStore>,
    token: String,
    content: String,
    expected_revision: Option<String>,
    force: bool,
) -> Result<DiskStat, String> {
    let path = capabilities.resolve(&token, true)?;
    atomic_write(
        &path,
        content.as_bytes(),
        expected_revision.as_deref(),
        force,
    )
}

#[tauri::command]
pub fn disk_write_bytes(
    capabilities: tauri::State<'_, CapabilityStore>,
    token: String,
    contents: Vec<u8>,
    expected_revision: Option<String>,
    force: bool,
) -> Result<DiskStat, String> {
    let path = capabilities.resolve(&token, true)?;
    atomic_write(&path, &contents, expected_revision.as_deref(), force)
}

#[tauri::command]
pub fn disk_stat(
    capabilities: tauri::State<'_, CapabilityStore>,
    token: String,
) -> Result<Option<DiskStat>, String> {
    let path = capabilities.resolve(&token, false)?;
    stat_path(&path)
}

#[tauri::command]
pub fn take_pending_open_paths(
    pending: tauri::State<'_, PendingOpenPaths>,
    capabilities: tauri::State<'_, CapabilityStore>,
) -> Vec<DiskGrant> {
    pending
        .take()
        .into_iter()
        .filter_map(|path| capabilities.grant_native_path(Path::new(&path), true).ok())
        .collect()
}

fn collect_explicit_paths(arguments: impl IntoIterator<Item = String>) -> Vec<String> {
    arguments
        .into_iter()
        .filter(|argument| !argument.starts_with('-'))
        .filter_map(|argument| {
            let path = PathBuf::from(argument);
            ensure_read_allowed(&path).ok()?;
            path.canonicalize()
                .ok()
                .map(|canonical| canonical.to_string_lossy().into_owned())
        })
        .collect()
}

pub fn collect_argv_paths() -> Vec<String> {
    collect_explicit_paths(std::env::args().skip(1))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(extension: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "mdsh-disk-{}-{}.{extension}",
            std::process::id(),
            Uuid::new_v4()
        ))
    }

    #[test]
    fn rejects_relative_traversal_and_unsupported_extensions() {
        assert!(ensure_read_allowed(Path::new("note.md")).is_err());
        assert!(ensure_read_allowed(&temp_path("pdf")).is_err());
        let raw = format!("{}/a/../evil.md", std::env::temp_dir().to_string_lossy());
        assert!(path_key(Path::new(&raw)).is_err());
        assert!(ensure_write_allowed(&temp_path("zip")).is_ok());
    }

    #[test]
    fn opaque_tokens_are_session_scoped_and_unforgeable() {
        let path = temp_path("md");
        fs::write(&path, "one").expect("fixture write");
        let first_session = CapabilityStore::default();
        let grant = first_session
            .grant_native_path(&path, true)
            .expect("native grant");
        assert_eq!(
            read_capability(&first_session, &grant.token).unwrap().1,
            "one"
        );
        assert!(first_session.resolve("forged-token", false).is_err());
        assert!(CapabilityStore::default()
            .resolve(&grant.token, false)
            .is_err());
        fs::remove_file(path).expect("fixture cleanup");
    }

    #[test]
    fn read_only_grant_reads_but_cannot_write() {
        let path = temp_path("md");
        fs::write(&path, "readable").expect("fixture write");
        let store = CapabilityStore::default();
        let grant = store
            .grant_native_path(&path, false)
            .expect("read-only native grant");
        assert_eq!(read_capability(&store, &grant.token).unwrap().1, "readable");
        assert!(store.resolve(&grant.token, true).is_err());
        fs::remove_file(path).expect("fixture cleanup");
    }

    #[test]
    fn atomic_write_detects_same_size_content_changes() {
        let path = temp_path("md");
        fs::write(&path, "one").expect("fixture write");
        let expected = stat_path(&path).unwrap().unwrap().revision;
        let permissions = fs::metadata(&path).unwrap().permissions();
        fs::write(&path, "two").expect("external write with same size");
        assert!(atomic_write(&path, b"new", Some(&expected), false).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "two");
        assert_eq!(fs::metadata(&path).unwrap().permissions(), permissions);
        fs::remove_file(path).expect("fixture cleanup");
    }

    #[test]
    fn atomic_write_replaces_after_revision_check_and_preserves_permissions() {
        let path = temp_path("md");
        fs::write(&path, "before").expect("fixture write");
        let before = stat_path(&path).unwrap().unwrap();
        let permissions = fs::metadata(&path).unwrap().permissions();
        let after = atomic_write(&path, b"after", Some(&before.revision), false).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "after");
        assert_eq!(after.size, 5);
        assert_eq!(fs::metadata(&path).unwrap().permissions(), permissions);
        fs::remove_file(path).expect("fixture cleanup");
    }

    #[test]
    fn failed_atomic_write_leaves_original_and_no_temp_file() {
        let path = temp_path("md");
        fs::write(&path, "original").expect("fixture write");
        let parent = path.parent().unwrap();
        let filename = path.file_name().unwrap().to_string_lossy();
        assert!(atomic_write(&path, b"replacement", Some("sha256:wrong"), false).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "original");
        let prefix = format!(".{filename}.");
        assert!(!fs::read_dir(parent)
            .unwrap()
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().starts_with(&prefix)));
        fs::remove_file(path).expect("fixture cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_substitution_after_grant() {
        use std::os::unix::fs::symlink;
        let selected = temp_path("md");
        let target = temp_path("md");
        fs::write(&selected, "selected").unwrap();
        fs::write(&target, "target").unwrap();
        let store = CapabilityStore::default();
        let grant = store.grant_native_path(&selected, true).unwrap();
        fs::remove_file(&selected).unwrap();
        symlink(&target, &selected).unwrap();
        assert!(store.resolve(&grant.token, false).is_err());
        assert!(CapabilityStore::default()
            .grant_native_path(&selected, true)
            .is_err());
        assert_eq!(fs::read_to_string(&target).unwrap(), "target");
        fs::remove_file(selected).unwrap();
        fs::remove_file(target).unwrap();
    }

    #[test]
    fn pending_paths_are_deduplicated_and_drained() {
        let pending = PendingOpenPaths::default();
        pending.push_many(["/tmp/a.md".to_string(), "/tmp/a.md".to_string()]);
        assert_eq!(pending.take(), vec!["/tmp/a.md"]);
        assert!(pending.take().is_empty());
    }

    #[test]
    fn argv_paths_create_only_canonical_allowed_grants() {
        let path = temp_path("md");
        fs::write(&path, "argv").expect("fixture write");
        let paths = collect_explicit_paths([
            "--ignored".to_string(),
            path.to_string_lossy().into_owned(),
            temp_path("pdf").to_string_lossy().into_owned(),
        ]);
        assert_eq!(paths, vec![path.canonicalize().unwrap().to_string_lossy()]);
        let store = CapabilityStore::default();
        let grant = store
            .grant_native_path(Path::new(&paths[0]), true)
            .expect("argv native grant");
        assert_eq!(read_capability(&store, &grant.token).unwrap().1, "argv");
        fs::remove_file(path).expect("fixture cleanup");
    }

    #[test]
    fn cancelled_save_selection_creates_no_capability() {
        let store = CapabilityStore::default();
        assert!(grant_save_selection(&store, None, "note.md", false)
            .unwrap()
            .is_none());
        assert!(store.resolve("anything", false).is_err());
    }

    #[test]
    fn save_extension_normalization_is_explicit() {
        assert_eq!(
            normalize_save_extension(PathBuf::from("/tmp/report"), "report.html", true),
            PathBuf::from("/tmp/report.html")
        );
        assert_eq!(
            normalize_save_extension(PathBuf::from("/tmp/note"), "note", false),
            PathBuf::from("/tmp/note.md")
        );
    }
}
