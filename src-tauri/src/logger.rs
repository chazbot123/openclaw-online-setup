use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use crate::error::AppResult;

pub fn append_line(path: &Path, message: &str) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(file, "[{timestamp}] {message}")?;
    Ok(())
}
