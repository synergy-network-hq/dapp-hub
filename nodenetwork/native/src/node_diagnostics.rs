use serde_json::{json, Value};

const SCHEMA: &str = "nodenetwork-diagnostics-v1";
const UNSUPPORTED: &str = "The selected controller returned unsupported target diagnostics.";
const MAX_COUNT: u64 = (1 << 53) - 1;
const MAX_DATE_MS: u64 = 8_640_000_000_000_000;
const LOG_WINDOW: u64 = 65_536;
const SEVERITY: [&str; 6] = ["error", "warn", "info", "debug", "trace", "unclassified"];

fn fields(value: &Value, keys: &[&str]) -> bool {
    value
        .as_object()
        .is_some_and(|map| map.len() == keys.len() && keys.iter().all(|key| map.contains_key(*key)))
}

fn counter(value: &Value) -> bool {
    value.is_null() || value.as_u64().is_some_and(|number| number <= MAX_COUNT)
}

fn installation(value: &Value) -> bool {
    fields(
        value,
        &[
            "role",
            "network_id",
            "node_name",
            "chain_id",
            "package_sha256",
        ],
    ) && matches!(value["role"].as_str(), Some("validator" | "rpc_gateway"))
        && value["network_id"].as_str().is_some_and(|text| {
            (2..=128).contains(&text.len())
                && text.as_bytes()[0].is_ascii_alphanumeric()
                && text.bytes().all(|byte| {
                    byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"_-".contains(&byte)
                })
        })
        && value["node_name"].as_str().is_some_and(|text| {
            (1..=64).contains(&text.len())
                && text
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))
        })
        && value["chain_id"].as_str().is_some_and(|text| {
            text.parse::<u64>()
                .is_ok_and(|number| number > 0 && number.to_string() == text)
        })
        && value["package_sha256"].as_str().is_some_and(|text| {
            text.len() == 64
                && text
                    .bytes()
                    .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
        })
}

fn service(value: &Value) -> Result<Value, &'static str> {
    if value.is_null() {
        return Ok(Value::Null);
    }
    let counters = ["pid", "restarts", "memory_bytes", "cpu_usage_ns"];
    if !fields(
        value,
        &["state", "pid", "restarts", "memory_bytes", "cpu_usage_ns"],
    ) || !counters.iter().all(|key| counter(&value[*key]))
        || !(value["state"].is_null()
            || matches!(
                value["state"].as_str(),
                Some(
                    "active"
                        | "inactive"
                        | "failed"
                        | "activating"
                        | "deactivating"
                        | "reloading"
                        | "maintenance"
                        | "refreshing"
                )
            ))
    {
        return Err(UNSUPPORTED);
    }
    Ok(json!({
        "state": value["state"], "restarts": value["restarts"],
        "memory_bytes": value["memory_bytes"], "cpu_usage_ns": value["cpu_usage_ns"]
    }))
}

fn log_summary(value: &Value) -> Result<(), &'static str> {
    if !fields(
        value,
        &[
            "available",
            "size_bytes",
            "window_bytes",
            "complete_lines",
            "severity",
        ],
    ) || !counter(&value["size_bytes"])
        || !fields(&value["severity"], &SEVERITY)
    {
        return Err(UNSUPPORTED);
    }
    let window = value["window_bytes"]
        .as_u64()
        .filter(|number| *number <= LOG_WINDOW)
        .ok_or(UNSUPPORTED)?;
    let complete = value["complete_lines"]
        .as_u64()
        .filter(|number| *number <= window)
        .ok_or(UNSUPPORTED)?;
    let counted = SEVERITY.iter().try_fold(0, |sum, key| {
        value["severity"][*key]
            .as_u64()
            .filter(|number| *number <= complete)
            .map(|number| sum + number)
    });
    if counted != Some(complete)
        || value["size_bytes"]
            .as_u64()
            .is_some_and(|size| size < window)
    {
        return Err(UNSUPPORTED);
    }
    match value["available"].as_bool() {
        Some(true) => Ok(()),
        Some(false) if window == 0 && value["size_bytes"].is_null() => Ok(()),
        _ => Err(UNSUPPORTED),
    }
}

pub(super) fn reply(value: &Value) -> Result<Value, &'static str> {
    if value["ok"] != true {
        return Err("The selected controller could not provide target diagnostics.");
    }
    let result = &value["result"];
    let storage = &result["storage"];
    let services = &result["services"];
    if !fields(value, &["version", "ok", "result"])
        || value["version"] != 1
        || !fields(
            result,
            &[
                "schema",
                "observed_at_ms",
                "installation",
                "services",
                "storage",
                "log",
            ],
        )
        || result["schema"] != SCHEMA
        || !result["observed_at_ms"]
            .as_u64()
            .is_some_and(|number| number <= MAX_DATE_MS)
        || !installation(&result["installation"])
        || !fields(services, &["node", "vpn"])
        || !fields(storage, &["capacity_bytes", "available_bytes"])
        || !counter(&storage["capacity_bytes"])
        || !counter(&storage["available_bytes"])
        || storage["capacity_bytes"]
            .as_u64()
            .zip(storage["available_bytes"].as_u64())
            .is_some_and(|(capacity, available)| available > capacity)
    {
        return Err(UNSUPPORTED);
    }
    log_summary(&result["log"])?;
    Ok(json!({"version": 1, "ok": true, "result": {
        "schema": SCHEMA, "observed_at_ms": result["observed_at_ms"], "storage": storage,
        "services": {"node": service(&services["node"])?, "vpn": service(&services["vpn"])?},
        "log": result["log"]
    }}))
}

pub(super) fn software_receipt_status(value: &Value, selection: &crate::node_controller::Request) -> &'static str {
    if reply(value).is_err() { return "unavailable"; }
    let installed=&value["result"]["installation"];
    let expected=&selection.parameters;
    let pin_matches=installed["package_sha256"]==expected["manifest_sha256"];
    let expected_chain_id=expected["chain_id"].as_u64().map(|id|id.to_string());
    // This path consumes a Request validated against the exact owner v1 parameters.
    let identity_matches=selection.operation=="upgrade" || (installed["role"]=="validator"
        && installed["network_id"]==expected["network_id"] && installed["node_name"]==expected["node_name"]
        && expected_chain_id.is_some() && installed["chain_id"].as_str()==expected_chain_id.as_deref());
    if pin_matches && identity_matches { "match" } else { "different" }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::node_controller::Request;

    fn fixture() -> Value {
        json!({"version": 1, "ok": true, "result": {
            "schema": SCHEMA, "observed_at_ms": 1_763_010_000_000_u64,
            "installation": {"role": "validator", "network_id": "fixture-network", "node_name": "fixture-node",
                "chain_id": "18446744073709551615", "package_sha256": "a".repeat(64)},
            "services": {"node": {"state": "active", "pid": 23, "restarts": 0, "memory_bytes": MAX_COUNT,
                "cpu_usage_ns": null}, "vpn": null},
            "storage": {"capacity_bytes": MAX_COUNT, "available_bytes": 0},
            "log": {"available": true, "size_bytes": LOG_WINDOW + 1, "window_bytes": LOG_WINDOW, "complete_lines": 2,
                "severity": {"error": 0, "warn": 1, "info": 1, "debug": 0, "trace": 0, "unclassified": 0}}
        }})
    }

    #[test]
    fn empty_parameters_keep_diagnostics_a_read() {
        let mut request = Request {
            version: 1,
            operation: "diagnostics".into(),
            parameters: json!({}),
        };
        assert_eq!(request.validate(), Ok(false));
        request.parameters = json!({"path": "/unreviewed"});
        assert!(request.validate().is_err());
    }

    #[test]
    fn projects_counters_without_installation_identifiers_pid_or_raw_refusal() {
        let value = fixture();
        let projected = reply(&value).unwrap();
        assert!(projected["result"].get("installation").is_none());
        assert!(projected["result"]["services"]["node"].get("pid").is_none());
        assert_eq!(
            projected["result"]["services"]["node"]["memory_bytes"],
            json!(MAX_COUNT)
        );
        assert_eq!(projected["result"]["services"]["vpn"], Value::Null);
        assert_eq!(projected["result"]["storage"], value["result"]["storage"]);
        assert_eq!(projected["result"]["log"], value["result"]["log"]);
        assert_eq!(
            reply(&json!({"version": 1, "ok": false, "error": {"message": "private fixture"}})),
            Err("The selected controller could not provide target diagnostics.")
        );
    }

    #[test]
    fn distinguishes_omitted_service_and_unavailable_log_counters_from_zero() {
        let mut value = fixture();
        value["result"]["services"]["node"]["state"] = Value::Null;
        value["result"]["storage"]["available_bytes"] = Value::Null;
        value["result"]["log"] = json!({"available": false, "size_bytes": null, "window_bytes": 0, "complete_lines": 0,
            "severity": {"error": 0, "warn": 0, "info": 0, "debug": 0, "trace": 0, "unclassified": 0}});
        let result = reply(&value).unwrap();
        assert_eq!(result["result"]["services"]["node"]["state"], Value::Null);
        assert_eq!(result["result"]["services"]["node"]["restarts"], json!(0));
        assert_eq!(result["result"]["storage"]["available_bytes"], Value::Null);
        assert_eq!(result["result"]["log"]["available"], json!(false));
    }

    #[test]
    fn rejects_unbounded_or_inconsistent_evidence() {
        for (path, data) in [
            ("/result/schema", json!("nodenetwork-diagnostics-v2")),
            ("/result/observed_at_ms", json!(MAX_DATE_MS + 1)),
            ("/result/services/node/state", json!("unknown")),
            ("/result/services/node/memory_bytes", json!(MAX_COUNT + 1)),
            ("/result/storage/capacity_bytes", json!(MAX_COUNT + 1)),
            ("/result/log/window_bytes", json!(LOG_WINDOW + 1)),
            ("/result/log/complete_lines", json!(1)),
            ("/result/log/available", json!(false)),
            ("/result/log/size_bytes", json!(1)),
            ("/result/log/severity/warn", json!(3)),
            (
                "/result/log/severity",
                json!({"error": 1, "raw": ["fixture content"]}),
            ),
        ] {
            let mut value = fixture();
            *value.pointer_mut(path).unwrap() = data;
            assert_eq!(reply(&value), Err(UNSUPPORTED), "{path}");
        }
    }
}
