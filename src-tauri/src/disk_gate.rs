//! Interruption gates for the isolated native smoke binary only.

use serde::Deserialize;
use std::path::Path;
use std::time::{Duration, Instant};

#[derive(Deserialize)]
struct Gate {
    path: String,
    stage: String,
}

pub fn wait(path: &Path, stage: &str) -> Result<(), String> {
    let Some(directory) = std::env::var_os("MDSH_SMOKE_DISK_GATE") else {
        return Ok(());
    };
    let directory = Path::new(&directory);
    let Ok(bytes) = std::fs::read(directory.join("armed.json")) else {
        return Ok(());
    };
    let gate: Gate = serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
    if path != Path::new(&gate.path) || stage != gate.stage {
        return Ok(());
    }
    std::fs::remove_file(directory.join("armed.json")).map_err(|error| error.to_string())?;
    std::fs::write(directory.join("reached"), stage).map_err(|error| error.to_string())?;
    let start = Instant::now();
    while !directory.join("release").exists() {
        if start.elapsed() > Duration::from_secs(15) {
            return Err("native disk gate timed out".into());
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    Ok(())
}
