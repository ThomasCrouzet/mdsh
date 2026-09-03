//! Native disk boundary for the desktop shell.
//!
//! The webview never grants paths. Native dialogs, process arguments and OS
//! file-open events create opaque, session-scoped capabilities. Every read,
//! stat and write command accepts only a capability token.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{ErrorKind, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

const ALLOWED_READ_EXTS: &[&str] = &["md", "markdown", "mdx", "txt"];
const ALLOWED_WRITE_EXTRA_EXTS: &[&str] = &["html", "htm", "zip", "json"];
const MAX_DIRECTORY_FILES: usize = 300;
const MAX_DIRECTORY_DEPTH: usize = 8;
const MAX_DIRECTORY_BYTES: u64 = 64 * 1024 * 1024;
const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;

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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskRead {
    pub content: String,
    pub stat: DiskStat,
}

#[derive(Serialize)]
pub struct RejectedOpenPath {
    pub path: String,
    pub reason: String,
}

#[derive(Serialize)]
pub struct PendingOpenDelivery {
    pub grants: Vec<PendingOpenGrant>,
    pub rejected: Vec<RejectedOpenPath>,
    pub remaining: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingOpenGrant {
    #[serde(flatten)]
    pub grant: DiskGrant,
    pub queued_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessedOpenPath {
    pub token: String,
    pub queued_path: String,
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

    pub fn snapshot(&self) -> Vec<String> {
        self.0.lock().map(|guard| guard.clone()).unwrap_or_default()
    }

    pub fn acknowledge(&self, paths: &[String]) {
        if let Ok(mut guard) = self.0.lock() {
            guard.retain(|path| !paths.contains(path));
        }
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
        if ensure_read_allowed(&normalized).is_ok()
            && fs::metadata(&normalized)
                .map(|metadata| metadata.len() > MAX_FILE_BYTES)
                .unwrap_or(false)
        {
            return Err("disk file exceeds the 16 MiB limit".to_string());
        }
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
    Ok(format_revision(&hasher.finalize()))
}

fn revision_for_bytes(contents: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(contents);
    format_revision(&hasher.finalize())
}

fn format_revision(digest: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut revision = String::with_capacity(7 + digest.len() * 2);
    revision.push_str("sha256:");
    for byte in digest {
        revision.push(char::from(HEX[usize::from(byte >> 4)]));
        revision.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    revision
}

fn disk_stat_from_metadata(metadata: &fs::Metadata, revision: String) -> Result<DiskStat, String> {
    if !metadata.is_file() {
        return Err("disk target is not a regular file".to_string());
    }
    let mtime_ms = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs_f64() * 1000.0)
        .unwrap_or(0.0);
    Ok(DiskStat {
        mtime_ms,
        size: metadata.len(),
        revision,
    })
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
    Ok(Some(disk_stat_from_metadata(
        &metadata,
        revision_for(path)?,
    )?))
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
        let metadata = file.metadata().map_err(|error| error.to_string())?;
        // Windows exige que le fichier de remplacement soit fermé.
        drop(file);
        // Le contrôle de révision reste la dernière étape avant le remplacement.
        ensure_expected_revision(path, expected_revision, force)?;
        replace_file(&temp, path)?;
        disk_stat_from_metadata(&metadata, revision_for_bytes(contents))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn read_capability(
    capabilities: &CapabilityStore,
    token: &str,
) -> Result<(PathBuf, DiskRead), String> {
    let path = capabilities.resolve(token, false)?;
    ensure_read_allowed(&path)?;
    let file = File::open(&path).map_err(|error| error.to_string())?;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("disk target is not a regular file".to_string());
    }
    if metadata.len() > MAX_FILE_BYTES {
        return Err("disk file exceeds the 16 MiB limit".to_string());
    }
    let mut contents = Vec::with_capacity(metadata.len().try_into().unwrap_or(0));
    file.take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut contents)
        .map_err(|error| error.to_string())?;
    if contents.len() as u64 > MAX_FILE_BYTES {
        return Err("disk file exceeds the 16 MiB limit".to_string());
    }
    let size = contents.len() as u64;
    let revision = revision_for_bytes(&contents);
    let content = String::from_utf8(contents).map_err(|_| "disk file is not UTF-8".to_string())?;
    if content
        .chars()
        .any(|character| (character as u32) < 32 && !matches!(character, '\t' | '\n' | '\r'))
    {
        return Err("disk file contains binary control characters".to_string());
    }
    let mut stat = disk_stat_from_metadata(&metadata, revision)?;
    stat.size = size;
    Ok((path, DiskRead { content, stat }))
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

fn collect_directory_paths(root: &Path) -> Result<Vec<PathBuf>, String> {
    let root = root.canonicalize().map_err(|error| error.to_string())?;
    if !root.is_dir() {
        return Err("selected path is not a directory".to_string());
    }
    let mut files = Vec::new();
    let mut total_bytes = 0_u64;
    let mut pending = vec![(root, 0_usize)];
    while let Some((directory, depth)) = pending.pop() {
        for entry in fs::read_dir(&directory).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
            if metadata.file_type().is_symlink() {
                continue;
            }
            if metadata.is_dir() {
                if depth >= MAX_DIRECTORY_DEPTH {
                    return Err(format!(
                        "directory exceeds the depth limit of {MAX_DIRECTORY_DEPTH}"
                    ));
                }
                pending.push((path, depth + 1));
                continue;
            }
            if !metadata.is_file() || ensure_read_allowed(&path).is_err() {
                continue;
            }
            if files.len() >= MAX_DIRECTORY_FILES {
                return Err(format!(
                    "directory contains more than {MAX_DIRECTORY_FILES} supported files"
                ));
            }
            if metadata.len() > MAX_FILE_BYTES {
                return Err("directory contains a file larger than 16 MiB".to_string());
            }
            total_bytes = total_bytes
                .checked_add(metadata.len())
                .ok_or_else(|| "directory size overflow".to_string())?;
            if total_bytes > MAX_DIRECTORY_BYTES {
                return Err("directory exceeds the 64 MiB import limit".to_string());
            }
            files.push(path);
        }
    }
    files.sort();
    Ok(files)
}

fn validate_import_paths(paths: &[PathBuf]) -> Result<(), String> {
    if paths.len() > MAX_DIRECTORY_FILES {
        return Err("selection exceeds the 300 file limit".to_string());
    }
    let mut total = 0_u64;
    for path in paths {
        ensure_read_allowed(path)?;
        reject_symlink(path)?;
        let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
        if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
            return Err(
                "selection contains an invalid file or a file larger than 16 MiB".to_string(),
            );
        }
        total = total
            .checked_add(metadata.len())
            .ok_or("selection size overflow")?;
        if total > MAX_DIRECTORY_BYTES {
            return Err("selection exceeds the 64 MiB import limit".to_string());
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn disk_open_dialog(
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
    let paths = selected
        .into_iter()
        .map(|file_path| file_path.into_path().map_err(|error| error.to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    validate_import_paths(&paths)?;
    paths
        .iter()
        .map(|path| capabilities.grant_native_path(path, true))
        .collect()
}

#[tauri::command]
pub async fn disk_save_dialog(
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
pub async fn disk_open_directory(
    app: tauri::AppHandle,
    capabilities: tauri::State<'_, CapabilityStore>,
) -> Result<Vec<DiskGrant>, String> {
    let Some(selected) = app.dialog().file().blocking_pick_folder() else {
        return Ok(Vec::new());
    };
    let root = selected.into_path().map_err(|error| error.to_string())?;
    collect_directory_paths(&root)?
        .into_iter()
        .map(|path| capabilities.grant_native_path(&path, true))
        .collect()
}

#[tauri::command]
pub async fn disk_read(
    capabilities: tauri::State<'_, CapabilityStore>,
    token: String,
) -> Result<DiskRead, String> {
    read_capability(&capabilities, &token).map(|(_, result)| result)
}

#[tauri::command]
pub async fn disk_write(
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
pub async fn disk_write_bytes(
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
pub async fn disk_stat(
    capabilities: tauri::State<'_, CapabilityStore>,
    token: String,
) -> Result<Option<DiskStat>, String> {
    let path = capabilities.resolve(&token, false)?;
    stat_path(&path)
}

#[tauri::command]
pub async fn take_pending_open_paths(
    pending: tauri::State<'_, PendingOpenPaths>,
    capabilities: tauri::State<'_, CapabilityStore>,
    exclude_paths: Option<Vec<String>>,
) -> Result<PendingOpenDelivery, String> {
    Ok(pending_delivery(
        &pending,
        &capabilities,
        MAX_DIRECTORY_FILES,
        MAX_DIRECTORY_BYTES,
        &exclude_paths.unwrap_or_default(),
    ))
}

fn pending_delivery(
    pending: &PendingOpenPaths,
    capabilities: &CapabilityStore,
    max_files: usize,
    max_bytes: u64,
    exclude_paths: &[String],
) -> PendingOpenDelivery {
    let excluded: HashSet<&str> = exclude_paths.iter().map(String::as_str).collect();
    let paths: Vec<String> = pending
        .snapshot()
        .into_iter()
        .filter(|path| !excluded.contains(path.as_str()))
        .collect();
    let mut delivery = PendingOpenDelivery {
        grants: Vec::new(),
        rejected: Vec::new(),
        remaining: paths.len(),
    };
    let mut total_bytes = 0;
    // Aucun élément ne quitte la file avant son acquittement explicite.
    // Les erreurs individuelles ne bloquent pas les autres chemins du lot.
    for source in paths.into_iter().take(max_files) {
        let path = Path::new(&source);
        let validated = validate_import_paths(&[path.to_path_buf()])
            .and_then(|()| fs::metadata(path).map_err(|error| error.to_string()));
        let result = match validated {
            Ok(metadata) => {
                if metadata.len() > max_bytes.saturating_sub(total_bytes) {
                    continue;
                }
                capabilities.grant_native_path(path, true)
            }
            Err(error) => Err(error),
        };
        match result {
            Ok(grant) => {
                let Some(stat) = &grant.stat else {
                    delivery.rejected.push(RejectedOpenPath {
                        path: source,
                        reason: "disk target disappeared before delivery".to_string(),
                    });
                    delivery.remaining -= 1;
                    continue;
                };
                // Le fichier peut avoir grandi entre validation et capability.
                if stat.size > max_bytes.saturating_sub(total_bytes) {
                    continue;
                }
                total_bytes += stat.size;
                delivery.grants.push(PendingOpenGrant {
                    grant,
                    queued_path: source,
                });
            }
            Err(reason) => delivery.rejected.push(RejectedOpenPath {
                path: source,
                reason,
            }),
        }
        delivery.remaining -= 1;
    }
    delivery
}

#[tauri::command]
pub fn ack_pending_open_paths(
    pending: tauri::State<'_, PendingOpenPaths>,
    capabilities: tauri::State<'_, CapabilityStore>,
    processed: Option<Vec<ProcessedOpenPath>>,
    rejected_paths: Option<Vec<String>>,
) -> Result<(), String> {
    acknowledge_delivery(
        &pending,
        &capabilities,
        &processed.unwrap_or_default(),
        &rejected_paths.unwrap_or_default(),
    )
}

fn acknowledge_delivery(
    pending: &PendingOpenPaths,
    capabilities: &CapabilityStore,
    processed: &[ProcessedOpenPath],
    rejected_paths: &[String],
) -> Result<(), String> {
    let snapshot = pending.snapshot();
    let mut paths = processed
        .iter()
        .map(|entry| {
            if !snapshot.contains(&entry.queued_path) {
                return Err("processed path is not pending".to_string());
            }
            let granted = capabilities.resolve(&entry.token, false)?;
            let queued = path_key(Path::new(&entry.queued_path))?;
            if queued != granted {
                return Err("processed path does not match its capability".to_string());
            }
            Ok(entry.queued_path.clone())
        })
        .collect::<Result<Vec<_>, _>>()?;
    for path in rejected_paths {
        if !snapshot.contains(path) {
            return Err("rejected path is not pending".to_string());
        }
        paths.push(path.clone());
    }
    pending.acknowledge(&paths);
    Ok(())
}

pub fn collect_explicit_paths(arguments: impl IntoIterator<Item = String>) -> Vec<String> {
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
    collect_paths_from_directory(
        std::env::args().skip(1),
        std::env::current_dir().ok().as_deref(),
    )
}

pub fn collect_paths_from_directory(
    arguments: impl IntoIterator<Item = String>,
    directory: Option<&Path>,
) -> Vec<String> {
    collect_explicit_paths(
        arguments
            .into_iter()
            .filter(|arg| !arg.starts_with('-'))
            .map(|arg| {
                let path = PathBuf::from(&arg);
                if path.is_absolute() {
                    return arg;
                }
                directory
                    .map(|base| base.join(path).to_string_lossy().into_owned())
                    .unwrap_or(arg)
            }),
    )
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
    fn sha256_revisions_keep_the_persisted_format_for_known_vectors() {
        let path = temp_path("md");
        for (contents, expected) in [
            (
                Vec::new(),
                "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            ),
            (
                b"abc".to_vec(),
                "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            ),
            (
                vec![b'a'; 1_000_000],
                "sha256:cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
            ),
        ] {
            assert_eq!(revision_for_bytes(&contents), expected);
            fs::write(&path, &contents).unwrap();
            assert_eq!(revision_for(&path).unwrap(), expected);
            assert!(ensure_expected_revision(&path, Some(expected), false).is_ok());
        }
        fs::remove_file(path).unwrap();
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
            read_capability(&first_session, &grant.token)
                .unwrap()
                .1
                .content,
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
        assert_eq!(
            read_capability(&store, &grant.token).unwrap().1.content,
            "readable"
        );
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
        assert_eq!(pending.snapshot(), vec!["/tmp/a.md"]);
        assert_eq!(pending.snapshot(), vec!["/tmp/a.md"]);
        pending.push_many(["/tmp/b.md".to_string()]);
        pending.acknowledge(&["/tmp/a.md".to_string()]);
        assert_eq!(pending.snapshot(), vec!["/tmp/b.md"]);
    }

    #[test]
    fn pending_delivery_is_bounded_and_does_not_remove_entries() {
        let first = temp_path("md");
        let second = temp_path("md");
        let third = temp_path("md");
        fs::write(&first, "123").unwrap();
        fs::write(&second, "456").unwrap();
        fs::write(&third, "789").unwrap();
        let paths = [&first, &second, &third].map(|path| path.to_string_lossy().into_owned());
        let pending = PendingOpenPaths::default();
        pending.push_many(paths.clone());
        let delivery = pending_delivery(&pending, &CapabilityStore::default(), 2, 4, &[]);
        assert_eq!(delivery.grants.len(), 1);
        assert!(delivery.rejected.is_empty());
        assert_eq!(delivery.remaining, 2);
        assert_eq!(pending.snapshot(), paths);
        for path in [first, second, third] {
            fs::remove_file(path).unwrap();
        }
    }

    #[test]
    fn pending_delivery_reports_invalid_paths_without_blocking_valid_ones() {
        let missing = temp_path("md");
        let valid = temp_path("md");
        fs::write(&valid, "content").unwrap();
        let paths = [
            missing.to_string_lossy().into_owned(),
            valid.to_string_lossy().into_owned(),
        ];
        let pending = PendingOpenPaths::default();
        pending.push_many(paths.clone());
        let delivery = pending_delivery(
            &pending,
            &CapabilityStore::default(),
            MAX_DIRECTORY_FILES,
            MAX_DIRECTORY_BYTES,
            &[],
        );
        assert_eq!(delivery.grants.len(), 1);
        assert_eq!(delivery.rejected.len(), 1);
        assert_eq!(delivery.rejected[0].path, paths[0]);
        assert_eq!(delivery.remaining, 0);
        assert_eq!(pending.snapshot(), paths);
        fs::remove_file(valid).unwrap();
    }

    #[test]
    fn pending_delivery_exclusions_let_later_batches_progress() {
        let first = temp_path("md");
        let second = temp_path("md");
        fs::write(&first, "first").unwrap();
        fs::write(&second, "second").unwrap();
        let first_name = first.to_string_lossy().into_owned();
        let second_name = second.to_string_lossy().into_owned();
        let pending = PendingOpenPaths::default();
        pending.push_many([first_name.clone(), second_name.clone()]);
        let delivery = pending_delivery(
            &pending,
            &CapabilityStore::default(),
            1,
            MAX_DIRECTORY_BYTES,
            std::slice::from_ref(&first_name),
        );
        assert_eq!(delivery.grants.len(), 1);
        assert_eq!(
            delivery.grants[0].grant.path,
            second.canonicalize().unwrap().to_string_lossy()
        );
        assert_eq!(delivery.remaining, 0);
        for path in [first, second] {
            fs::remove_file(path).unwrap();
        }
    }

    #[test]
    fn pending_ack_links_capability_to_the_exact_queued_path() {
        let path = temp_path("md");
        fs::write(&path, "content").unwrap();
        let queued = format!(
            "{}/./{}",
            path.parent().unwrap().to_string_lossy(),
            path.file_name().unwrap().to_string_lossy()
        );
        let pending = PendingOpenPaths::default();
        pending.push_many([queued.clone()]);
        let capabilities = CapabilityStore::default();
        let grant = capabilities
            .grant_native_path(Path::new(&queued), true)
            .unwrap();
        acknowledge_delivery(
            &pending,
            &capabilities,
            &[ProcessedOpenPath {
                token: grant.token,
                queued_path: queued,
            }],
            &[],
        )
        .unwrap();
        assert!(pending.snapshot().is_empty());
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn pending_ack_refuses_a_token_for_another_path() {
        let first = temp_path("md");
        let second = temp_path("md");
        fs::write(&first, "first").unwrap();
        fs::write(&second, "second").unwrap();
        let first_name = first.to_string_lossy().into_owned();
        let pending = PendingOpenPaths::default();
        pending.push_many([first_name.clone()]);
        let capabilities = CapabilityStore::default();
        let grant = capabilities.grant_native_path(&second, true).unwrap();
        assert!(acknowledge_delivery(
            &pending,
            &capabilities,
            &[ProcessedOpenPath {
                token: grant.token,
                queued_path: first_name,
            }],
            &[],
        )
        .is_err());
        assert_eq!(pending.snapshot().len(), 1);
        fs::remove_file(first).unwrap();
        fs::remove_file(second).unwrap();
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
        assert_eq!(
            read_capability(&store, &grant.token).unwrap().1.content,
            "argv"
        );
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

    #[test]
    fn directory_import_is_sorted_bounded_and_skips_symlinks() {
        let root = std::env::temp_dir().join(format!(
            "mdsh-directory-{}-{}",
            std::process::id(),
            Uuid::new_v4()
        ));
        fs::create_dir_all(root.join("nested")).unwrap();
        fs::write(root.join("b.md"), "b").unwrap();
        fs::write(root.join("nested/a.txt"), "a").unwrap();
        fs::write(root.join("ignored.pdf"), "x").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(root.join("b.md"), root.join("linked.md")).unwrap();
        let files = collect_directory_paths(&root).unwrap();
        let canonical_root = root.canonicalize().unwrap();
        assert_eq!(
            files,
            vec![
                canonical_root.join("b.md"),
                canonical_root.join("nested/a.txt")
            ]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn versioned_read_hashes_the_returned_content() {
        let path = temp_path("md");
        fs::write(&path, "versioned content").unwrap();
        let store = CapabilityStore::default();
        let grant = store.grant_native_path(&path, true).unwrap();
        let read = read_capability(&store, &grant.token).unwrap().1;
        assert_eq!(read.content, "versioned content");
        assert_eq!(read.stat.size, 17);
        assert_eq!(
            read.stat.revision,
            revision_for_bytes(read.content.as_bytes())
        );
        fs::remove_file(path).unwrap();
    }
    #[test]
    fn import_limits_reject_before_reading_and_binary_is_not_markdown() {
        let path = temp_path("md");
        let file = File::create(&path).unwrap();
        file.set_len(MAX_FILE_BYTES + 1).unwrap();
        let capabilities = CapabilityStore::default();
        assert!(capabilities.grant_native_path(&path, true).is_err());
        assert!(validate_import_paths(std::slice::from_ref(&path)).is_err());
        for bytes in [&b"text\0binary"[..], &[0xff_u8][..], &b"text\x01binary"[..]] {
            fs::write(&path, bytes).unwrap();
            let grant = capabilities.grant_native_path(&path, true).unwrap();
            assert!(read_capability(&capabilities, &grant.token).is_err());
        }
        fs::write(&path, "text\tline\nnext\r\n").unwrap();
        let grant = capabilities.grant_native_path(&path, true).unwrap();
        assert!(read_capability(&capabilities, &grant.token).is_ok());
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn selection_limits_are_checked_as_a_batch() {
        let path = temp_path("md");
        let file = File::create(&path).unwrap();
        file.set_len(MAX_FILE_BYTES).unwrap();
        assert!(validate_import_paths(&vec![path.clone(); 4]).is_ok());
        assert!(validate_import_paths(&vec![path.clone(); 5]).is_err());
        assert!(validate_import_paths(&vec![path.clone(); MAX_DIRECTORY_FILES + 1]).is_err());
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn directory_depth_never_silently_truncates_an_import() {
        let root = std::env::temp_dir().join(format!("mdsh-depth-{}", Uuid::new_v4()));
        let mut nested = root.clone();
        for _ in 0..=MAX_DIRECTORY_DEPTH {
            nested = nested.join("nested");
        }
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("note.md"), "content").unwrap();
        assert!(collect_directory_paths(&root)
            .unwrap_err()
            .contains("depth"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn relative_native_arguments_resolve_against_the_launch_directory() {
        let path = temp_path("md");
        fs::write(&path, "content").unwrap();
        let result = collect_paths_from_directory(
            [path.file_name().unwrap().to_string_lossy().into_owned()],
            path.parent(),
        );
        assert_eq!(
            result,
            vec![path.canonicalize().unwrap().to_string_lossy().into_owned()]
        );
        fs::remove_file(path).unwrap();
    }
}
