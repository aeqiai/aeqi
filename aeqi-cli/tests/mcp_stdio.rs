use std::io::Write;
use std::os::unix::net::UnixListener;
use std::process::{Command, Stdio};

#[test]
fn mcp_stdio_tool_error_does_not_close_transport() {
    let tmp = tempfile::tempdir().expect("temp dir");
    let data_dir = tmp.path().join("data");
    std::fs::create_dir_all(&data_dir).expect("data dir");
    let socket_path = data_dir.join("rm.sock");
    let _listener = UnixListener::bind(&socket_path).expect("bind local runtime socket");

    let config_path = tmp.path().join("aeqi.toml");
    std::fs::write(
        &config_path,
        format!(
            "[aeqi]\nname = \"mcp-stdio-test\"\ndata_dir = \"{}\"\n",
            data_dir.display()
        ),
    )
    .expect("write config");

    let mut child = Command::new(env!("CARGO_BIN_EXE_aeqi"))
        .arg("--config")
        .arg(&config_path)
        .arg("mcp")
        .env_remove("AEQI_SECRET_KEY")
        .env_remove("AEQI_API_KEY")
        .env_remove("AEQI_AGENT")
        .env_remove("AEQI_AGENT_ID")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn aeqi mcp");

    {
        let stdin = child.stdin.as_mut().expect("child stdin");
        writeln!(
            stdin,
            "{}",
            serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {}
            })
        )
        .expect("write initialize");
        writeln!(
            stdin,
            "{}",
            serde_json::json!({
                "jsonrpc": "2.0",
                "method": "notifications/initialized",
                "params": {}
            })
        )
        .expect("write initialized notification");
        writeln!(
            stdin,
            "{}",
            serde_json::json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": "code",
                    "arguments": {
                        "action": "incremental",
                        "project": "missing-project"
                    }
                }
            })
        )
        .expect("write failing tool call");
        writeln!(
            stdin,
            "{}",
            serde_json::json!({
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {
                    "name": "me",
                    "arguments": {"action": "profile"}
                }
            })
        )
        .expect("write follow-up tool call");
    }
    drop(child.stdin.take());

    let output = child.wait_with_output().expect("wait for aeqi mcp");
    assert!(
        output.status.success(),
        "mcp process should exit cleanly after stdin EOF; stderr={}",
        String::from_utf8_lossy(&output.stderr)
    );

    let stdout = String::from_utf8(output.stdout).expect("stdout utf8");
    let responses: Vec<serde_json::Value> = stdout
        .lines()
        .map(|line| serde_json::from_str(line).expect("json-rpc response"))
        .collect();

    assert_eq!(responses.len(), 3, "stdout={stdout}");
    assert_eq!(responses[0]["id"], 1);
    assert_eq!(responses[1]["id"], 2);
    assert_eq!(responses[1]["result"]["isError"], true);
    assert!(
        responses[1]["result"]["content"][0]["text"]
            .as_str()
            .unwrap_or_default()
            .contains("project 'missing-project' not found"),
        "tool error response should include project lookup failure: {}",
        responses[1]
    );
    assert_eq!(responses[2]["id"], 3);
    assert_eq!(responses[2]["result"]["structuredContent"]["mode"], "local");
}
