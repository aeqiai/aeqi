use anyhow::Result;
use std::io::{BufRead, Write};
use std::path::PathBuf;

use crate::helpers::load_config;

pub(crate) fn cmd_primer(config_path: &Option<PathBuf>) -> Result<()> {
    let agent = std::env::var("AEQI_AGENT").unwrap_or_default();
    if agent.is_empty() {
        return Ok(());
    }

    let (config, ..) = load_config(config_path)?;
    let sock_path = config.data_dir().join("rm.sock");

    if !sock_path.exists() {
        return Ok(());
    }

    // Connect to daemon and send trigger_event
    let stream = match std::os::unix::net::UnixStream::connect(&sock_path) {
        Ok(s) => s,
        Err(_) => return Ok(()),
    };
    let mut writer = std::io::BufWriter::new(&stream);
    let mut reader = std::io::BufReader::new(&stream);

    let request = serde_json::json!({
        "cmd": "trigger_event",
        "agent": agent,
        "pattern": "session:start",
    });

    let mut req_bytes = serde_json::to_vec(&request)?;
    req_bytes.push(b'\n');
    writer.write_all(&req_bytes)?;
    writer.flush()?;

    let mut line = String::new();
    reader.read_line(&mut line)?;

    let response: serde_json::Value = match serde_json::from_str(&line) {
        Ok(v) => v,
        Err(_) => return Ok(()),
    };

    let prompt = response
        .get("system_prompt")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if !prompt.is_empty() {
        println!("# Session Primer (agent: {agent})");
        println!("{prompt}");
    }

    Ok(())
}
