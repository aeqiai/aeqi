//! Validation for event `tool_calls[].args` against each tool's `input_schema`.
//!
//! Runs at event create/update time so misconfigured events fail at save, not
//! at first fire. Minimal JSON-Schema subset: `type`, `required`, `properties.type`.
//! That covers every schema the runtime tools actually declare.

use std::collections::HashMap;

use aeqi_core::traits::ToolSpec;

use crate::event_handler::ToolCall;
use crate::runtime_tools::runtime_tool_specs;

/// Tool names that are exposed via MCP (handled outside the runtime registry).
/// We accept them as valid names but do not type-check their args — their
/// schemas live in the MCP layer. This list stays in sync with the UI's
/// `KNOWN_TOOLS` constant.
const MCP_TOOL_NAMES: &[&str] = &["agents", "quests", "events", "code", "ideas", "web"];

/// Validate a sequence of configured tool calls.
/// Returns `Err` with a human-readable message on the first failing call.
pub fn validate_tool_calls(tool_calls: &[ToolCall]) -> Result<(), String> {
    let specs = runtime_tool_specs();
    for (idx, call) in tool_calls.iter().enumerate() {
        validate_one(idx, call, &specs)?;
    }
    Ok(())
}

fn validate_one(
    idx: usize,
    call: &ToolCall,
    specs: &HashMap<String, ToolSpec>,
) -> Result<(), String> {
    let prefix = format!("tool_calls[{idx}] ({})", call.tool);

    if call.tool.is_empty() {
        return Err(format!("tool_calls[{idx}]: tool name is required"));
    }

    if let Some(spec) = specs.get(&call.tool) {
        validate_against_schema(&prefix, &call.args, &spec.input_schema)?;
        return Ok(());
    }

    if MCP_TOOL_NAMES.contains(&call.tool.as_str()) {
        // MCP tools: accept any object; schema lives in the MCP layer.
        if !call.args.is_object() {
            return Err(format!("{prefix}: args must be a JSON object"));
        }
        return Ok(());
    }

    Err(format!("{prefix}: unknown tool"))
}

fn validate_against_schema(
    prefix: &str,
    args: &serde_json::Value,
    schema: &serde_json::Value,
) -> Result<(), String> {
    let expected_type = schema.get("type").and_then(|v| v.as_str()).unwrap_or("");
    if expected_type == "object" && !args.is_object() {
        return Err(format!("{prefix}: args must be a JSON object"));
    }
    let args_obj = args.as_object();

    if let Some(required) = schema.get("required").and_then(|v| v.as_array()) {
        let obj = args_obj.ok_or_else(|| format!("{prefix}: args must be a JSON object"))?;
        for field in required {
            let Some(key) = field.as_str() else { continue };
            if !obj.contains_key(key) {
                return Err(format!("{prefix}: missing required field `{key}`"));
            }
        }
    }

    if let (Some(obj), Some(props)) = (
        args_obj,
        schema.get("properties").and_then(|v| v.as_object()),
    ) {
        for (key, value) in obj {
            let Some(prop_schema) = props.get(key) else {
                continue;
            };
            let Some(prop_type) = prop_schema.get("type").and_then(|v| v.as_str()) else {
                continue;
            };
            if !type_matches(prop_type, value) {
                return Err(format!(
                    "{prefix}: field `{key}` must be {prop_type}, got {}",
                    describe_json_type(value)
                ));
            }
        }
    }

    Ok(())
}

fn type_matches(expected: &str, value: &serde_json::Value) -> bool {
    match expected {
        "object" => value.is_object(),
        "array" => value.is_array(),
        "string" => value.is_string(),
        "number" => value.is_number(),
        "integer" => value.is_i64() || value.is_u64(),
        "boolean" => value.is_boolean(),
        "null" => value.is_null(),
        _ => true,
    }
}

fn describe_json_type(value: &serde_json::Value) -> &'static str {
    match value {
        serde_json::Value::Null => "null",
        serde_json::Value::Bool(_) => "boolean",
        serde_json::Value::Number(_) => "number",
        serde_json::Value::String(_) => "string",
        serde_json::Value::Array(_) => "array",
        serde_json::Value::Object(_) => "object",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tc(tool: &str, args: serde_json::Value) -> ToolCall {
        ToolCall {
            tool: tool.to_string(),
            args,
        }
    }

    #[test]
    fn accepts_valid_ideas_assemble() {
        let calls = vec![tc(
            "ideas.assemble",
            serde_json::json!({"names": ["identity"]}),
        )];
        assert!(validate_tool_calls(&calls).is_ok());
    }

    #[test]
    fn rejects_missing_required_field() {
        let calls = vec![tc("ideas.assemble", serde_json::json!({}))];
        let err = validate_tool_calls(&calls).unwrap_err();
        assert!(err.contains("missing required field `names`"), "got: {err}");
    }

    #[test]
    fn rejects_wrong_type() {
        let calls = vec![tc(
            "ideas.assemble",
            serde_json::json!({"names": "should-be-array"}),
        )];
        let err = validate_tool_calls(&calls).unwrap_err();
        assert!(err.contains("must be array"), "got: {err}");
    }

    #[test]
    fn rejects_unknown_tool() {
        let calls = vec![tc("does.not.exist", serde_json::json!({}))];
        let err = validate_tool_calls(&calls).unwrap_err();
        assert!(err.contains("unknown tool"), "got: {err}");
    }

    #[test]
    fn accepts_mcp_tools_without_schema_check() {
        let calls = vec![tc("ideas", serde_json::json!({"action": "search"}))];
        assert!(validate_tool_calls(&calls).is_ok());
    }

    #[test]
    fn rejects_mcp_tool_with_non_object_args() {
        let calls = vec![tc("ideas", serde_json::json!("not-an-object"))];
        let err = validate_tool_calls(&calls).unwrap_err();
        assert!(err.contains("must be a JSON object"), "got: {err}");
    }

    #[test]
    fn empty_tool_calls_is_ok() {
        assert!(validate_tool_calls(&[]).is_ok());
    }

    #[test]
    fn empty_tool_name_rejected() {
        let calls = vec![tc("", serde_json::json!({}))];
        assert!(validate_tool_calls(&calls).is_err());
    }
}
