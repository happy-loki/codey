use crate::codex_integration::CodexState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;

const MAX_SCAN_BYTES: u64 = 64 * 1024 * 1024;
const MAX_RECORD_BYTES: usize = 1024 * 1024;

#[derive(Default, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SubagentMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    effort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    fork_turns: Option<String>,
}

// Deliberately deserialize only metadata. Task text, encrypted payloads,
// commands and tool outputs are never retained or returned to the WebView.
#[derive(Deserialize)]
struct Record {
    ordinal: Option<u64>,
    #[serde(flatten)]
    data: RecordData,
}

#[derive(Deserialize)]
#[serde(tag = "type", content = "payload")]
enum RecordData {
    #[serde(rename = "session_meta")]
    SessionMeta {
        id: String,
        forked_from_id: Option<String>,
        subagent_history_start_ordinal: Option<u64>,
    },
    #[serde(rename = "turn_context")]
    TurnContext {
        model: Option<String>,
        effort: Option<String>,
    },
    #[serde(rename = "response_item")]
    ResponseItem {
        #[serde(rename = "type")]
        kind: String,
        name: Option<String>,
        call_id: Option<String>,
        arguments: Option<String>,
    },
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
struct SpawnArguments {
    fork_turns: Option<String>,
    fork_context: Option<bool>,
    task_name: Option<String>,
}

fn fork_turns(arguments: &str) -> Option<String> {
    let args: SpawnArguments = serde_json::from_str(arguments).ok()?;
    if let Some(value) = args.fork_turns {
        let value = value.trim().to_ascii_lowercase();
        return match value.as_str() {
            "none" | "all" => Some(value),
            _ => value
                .parse::<u32>()
                .ok()
                .filter(|n| *n > 0)
                .map(|n| n.to_string()),
        };
    }
    if let Some(inherit) = args.fork_context {
        return Some(if inherit { "all" } else { "none" }.into());
    }
    // Only the v2 task_name schema has the default `all`. Missing data in an
    // unknown/older call must not silently acquire the v2 default.
    args.task_name
        .filter(|name| !name.is_empty())
        .map(|_| "all".into())
}

fn clean_field(value: Option<String>) -> Option<String> {
    value.filter(|text| {
        !text.trim().is_empty() && text.len() <= 160 && !text.chars().any(char::is_control)
    })
}

fn scan_metadata(path: &Path, thread_id: &str, spawn_call_id: Option<&str>) -> SubagentMetadata {
    let mut result = SubagentMetadata::default();
    if path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
        return result;
    }
    let Ok(file) = File::open(path) else {
        return result;
    };
    let Ok(size) = file.metadata().map(|m| m.len()) else {
        return result;
    };
    // Do not show an out-of-date model from only the prefix of a large history.
    if size > MAX_SCAN_BYTES {
        return result;
    }
    let mut reader = BufReader::new(file.take(size));
    let mut verified = false;
    let mut child_start = None;
    let mut forked = false;
    let mut index = 0u64;
    let mut line = Vec::new();
    loop {
        line.clear();
        let Ok(read) = reader
            .by_ref()
            .take((MAX_RECORD_BYTES + 1) as u64)
            .read_until(b'\n', &mut line)
        else {
            return SubagentMetadata::default();
        };
        if read == 0 {
            break;
        }
        let fallback_ordinal = index;
        index += 1;
        if line.len() > MAX_RECORD_BYTES {
            if !verified {
                return result;
            }
            if !line.ends_with(b"\n") && reader.skip_until(b'\n').is_err() {
                return SubagentMetadata::default();
            }
            continue;
        }
        let Ok(record) = serde_json::from_slice::<Record>(&line) else {
            if !verified {
                return result;
            }
            continue; // A live file may end with an incomplete write.
        };
        if !verified {
            let RecordData::SessionMeta {
                id,
                forked_from_id,
                subagent_history_start_ordinal,
            } = record.data
            else {
                return result;
            };
            if id != thread_id {
                return result;
            }
            child_start = subagent_history_start_ordinal;
            forked = forked_from_id.is_some();
            verified = true;
            continue;
        }
        let ordinal = record.ordinal.unwrap_or(fallback_ordinal);
        match record.data {
            RecordData::TurnContext { model, effort }
                if spawn_call_id.is_none()
                    && child_start.map(|start| ordinal >= start).unwrap_or(!forked) =>
            {
                result.model = clean_field(model);
                result.effort = clean_field(effort);
            }
            RecordData::ResponseItem {
                kind,
                name,
                call_id,
                arguments,
            } if spawn_call_id.is_some()
                && call_id.as_deref() == spawn_call_id
                && kind == "function_call"
                && name.as_deref().is_some_and(|name| {
                    name == "spawn_agent" || name.ends_with(".spawn_agent")
                }) =>
            {
                result.fork_turns = arguments.as_deref().and_then(fork_turns);
                break;
            }
            _ => {}
        }
    }
    result
}

fn thread_path(thread: &Value) -> Option<String> {
    thread.get("path")?.as_str().map(str::to_owned)
}

#[tauri::command]
pub async fn codex_subagent_metadata(
    state: tauri::State<'_, CodexState>,
    thread_id: String,
    parent_thread_id: String,
    spawn_call_id: Option<String>,
) -> Result<Value, String> {
    let mut response = state
        .send_request(
            "thread/read".into(),
            Some(json!({
                "threadId": thread_id, "includeTurns": false,
            })),
        )
        .await
        .map_err(|e| e.to_string())?;
    let thread = &response["thread"];
    if thread["id"].as_str() != Some(&thread_id)
        || thread["parentThreadId"].as_str() != Some(&parent_thread_id)
        || thread_id == parent_thread_id
    {
        return Ok(response);
    }
    let child_path = thread_path(thread);
    let parent_path = if spawn_call_id.is_some() {
        state
            .send_request(
                "thread/read".into(),
                Some(json!({
                    "threadId": parent_thread_id, "includeTurns": false,
                })),
            )
            .await
            .ok()
            .and_then(|reply| {
                (reply["thread"]["id"].as_str() == Some(&parent_thread_id))
                    .then(|| thread_path(&reply["thread"]))
                    .flatten()
            })
    } else {
        None
    };
    let metadata = tauri::async_runtime::spawn_blocking(move || {
        let mut metadata = child_path
            .map(|path| scan_metadata(Path::new(&path), &thread_id, None))
            .unwrap_or_default();
        if let (Some(path), Some(call_id)) = (parent_path, spawn_call_id) {
            metadata.fork_turns =
                scan_metadata(Path::new(&path), &parent_thread_id, Some(&call_id)).fork_turns;
        }
        metadata
    })
    .await
    .unwrap_or_default();
    response["metadata"] = serde_json::to_value(metadata).unwrap_or_else(|_| json!({}));
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn fixture(records: &[Value]) -> tempfile::NamedTempFile {
        let mut file = tempfile::Builder::new()
            .suffix(".jsonl")
            .tempfile()
            .unwrap();
        for record in records {
            writeln!(file, "{record}").unwrap();
        }
        file
    }

    #[test]
    fn own_context_does_not_use_inherited_parent_model() {
        let file = fixture(&[
            json!({"ordinal":0,"type":"session_meta","payload":{"id":"child","forked_from_id":"parent","subagent_history_start_ordinal":10}}),
            json!({"ordinal":1,"type":"turn_context","payload":{"model":"parent-model","effort":"low"}}),
            json!({"ordinal":10,"type":"turn_context","payload":{"model":"child-model","effort":"high"}}),
            json!({"ordinal":11,"type":"session_meta","payload":{"id":"parent"}}),
            json!({"ordinal":12,"type":"turn_context","payload":{"model":"child-model-v2","effort":"xhigh"}}),
        ]);
        let metadata = scan_metadata(file.path(), "child", None);
        assert_eq!(metadata.model.as_deref(), Some("child-model-v2"));
        assert_eq!(metadata.effort.as_deref(), Some("xhigh"));
        assert_eq!(
            scan_metadata(file.path(), "wrong-thread", None),
            SubagentMetadata::default()
        );
    }

    #[test]
    fn exact_spawn_call_ignores_encrypted_task_and_other_agents() {
        let file = fixture(&[
            json!({"type":"session_meta","payload":{"id":"parent"}}),
            json!({"type":"response_item","payload":{"type":"function_call","name":"spawn_agent","call_id":"other","arguments":"{\"fork_turns\":\"none\"}"}}),
            json!({"type":"response_item","payload":{"type":"function_call","name":"spawn_agent","call_id":"wanted","arguments":"{\"fork_turns\":\"3\",\"message\":\"encrypted-task-secret\"}"}}),
        ]);
        let metadata = scan_metadata(file.path(), "parent", Some("wanted"));
        assert_eq!(
            serde_json::to_value(metadata).unwrap(),
            json!({"forkTurns":"3"})
        );
        assert_eq!(
            scan_metadata(file.path(), "parent", Some("missing")),
            SubagentMetadata::default()
        );
    }

    #[test]
    fn inheritance_modes_and_version_defaults() {
        for (args, expected) in [
            (json!({"fork_turns":"all"}), Some("all")),
            (json!({"fork_turns":"none"}), Some("none")),
            (json!({"fork_turns":"2"}), Some("2")),
            (json!({"fork_context":false}), Some("none")),
            (json!({"fork_context":true}), Some("all")),
            (json!({"task_name":"review"}), Some("all")),
            (json!({}), None),
            (json!({"fork_turns":"0"}), None),
            (json!({"fork_turns":"bogus"}), None),
        ] {
            assert_eq!(fork_turns(&args.to_string()).as_deref(), expected);
        }
    }

    #[test]
    fn missing_boundary_or_context_never_assumes_parent_model() {
        for boundary in [Value::Null, json!(20)] {
            let file = fixture(&[
                json!({"type":"session_meta","payload":{"id":"child","forked_from_id":"parent","subagent_history_start_ordinal":boundary}}),
                json!({"type":"turn_context","payload":{"model":"parent-model"}}),
            ]);
            assert_eq!(scan_metadata(file.path(), "child", None).model, None);
        }
        let file = fixture(&[
            json!({"type":"session_meta","payload":{"id":"child"}}),
            json!({"type":"turn_context","payload":{"model":"child-model","effort":"medium"}}),
        ]);
        assert_eq!(
            scan_metadata(file.path(), "child", None).model.as_deref(),
            Some("child-model")
        );
        assert_eq!(
            scan_metadata(Path::new("missing.jsonl"), "child", None),
            SubagentMetadata::default()
        );
    }

    #[test]
    fn oversized_output_and_incomplete_tail_do_not_break_metadata() {
        let mut file = fixture(&[
            json!({"type":"session_meta","payload":{"id":"child"}}),
            json!({"type":"response_item","payload":{"type":"function_call_output","output":"x".repeat(MAX_RECORD_BYTES + 20)}}),
            json!({"type":"turn_context","payload":{"model":"actual-model","effort":"high"}}),
        ]);
        write!(file, "{{\"type\":\"turn_context\",\"payload\":").unwrap();
        let metadata = scan_metadata(file.path(), "child", None);
        assert_eq!(metadata.model.as_deref(), Some("actual-model"));
        assert_eq!(metadata.effort.as_deref(), Some("high"));
    }

    #[test]
    #[ignore = "requires explicit read-only rollout paths from a real app-server"]
    fn subagent_metadata_live() {
        let config: Value = serde_json::from_str(
            &std::env::var("CODEY_SUBAGENT_SMOKE").expect("CODEY_SUBAGENT_SMOKE required"),
        )
        .unwrap();
        let child = scan_metadata(
            Path::new(config["childPath"].as_str().unwrap()),
            config["childId"].as_str().unwrap(),
            None,
        );
        let parent = scan_metadata(
            Path::new(config["parentPath"].as_str().unwrap()),
            config["parentId"].as_str().unwrap(),
            config["callId"].as_str(),
        );
        assert_eq!(child.model.as_deref(), config["model"].as_str());
        assert_eq!(child.effort.as_deref(), config["effort"].as_str());
        assert_eq!(parent.fork_turns.as_deref(), config["forkTurns"].as_str());
        assert!(child.model.is_some() && parent.fork_turns.is_some());
    }
}
