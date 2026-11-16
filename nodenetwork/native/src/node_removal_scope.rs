use crate::node_controller::ROOT;
use serde_json::{json, Value};
use std::collections::HashSet;

const UNSUPPORTED: &str = "The selected controller returned unsupported removal scope evidence.";
pub(super) const REMOVAL_UNCERTAIN: &str = "Removal outcome is uncertain. Ask the node operator to reconcile the selected installation before another change.";
const SCOPES: [&str; 4] = ["chain_data", "custody", "recovery", "other"];

#[derive(Clone, Copy, Default)]
struct Counts {
    files: usize,
    directories: usize,
    sockets: usize,
    file_bytes: u128,
}

pub(super) fn reply(value: &Value) -> Result<Value, &'static str> {
    if value["ok"] != true {
        return Err("The controller could not confirm removal scope. Ask the node operator to review the installation and registration state.");
    }
    let result = &value["result"];
    let inventory = &result["inventory"];
    if !value.as_object().is_some_and(|fields| fields.len() == 3)
        || value["version"] != 1
        || !result.as_object().is_some_and(|fields| fields.len() == 5)
        || result["root"] != ROOT
        || result["destructive"] != true
        || result["forensicErasureProven"] != false
        || !result["managedAccountRemoval"].is_boolean()
        || !inventory
            .as_object()
            .is_some_and(|fields| fields.len() == 3)
        || inventory["root"] != ROOT
        || inventory["outsideRootAuditComplete"] != false
    {
        return Err(UNSUPPORTED);
    }
    let members = inventory["members"]
        .as_array()
        .filter(|rows| rows.len() <= 20_000)
        .ok_or(UNSUPPORTED)?;
    let mut seen = HashSet::with_capacity(members.len());
    let mut groups = [Counts::default(); SCOPES.len()];
    for row in members {
        if !row.as_object().is_some_and(|fields| fields.len() == 3) {
            return Err(UNSUPPORTED);
        }
        let path = row["path"]
            .as_str()
            .filter(|path| {
                path.len() <= 4096
                    && !path.contains('\0')
                    && path
                        .split('/')
                        .all(|segment| !matches!(segment, "" | "." | ".."))
            })
            .ok_or(UNSUPPORTED)?;
        if !seen.insert(path) {
            return Err(UNSUPPORTED);
        }
        let size = row["bytes"].as_u64().ok_or(UNSUPPORTED)?;
        let index = match path.split('/').next() {
            Some("data") => 0,
            Some("keys") => 1,
            Some("recovery") => 2,
            _ => 3,
        };
        let scope = &mut groups[index];
        match row["type"].as_str() {
            Some("file") => {
                scope.files += 1;
                scope.file_bytes += u128::from(size);
            }
            Some("directory") => scope.directories += 1,
            Some("socket") => scope.sockets += 1,
            _ => return Err(UNSUPPORTED),
        }
    }
    let scopes = SCOPES.into_iter().zip(groups).map(|(id, count)| json!({
        "id":id, "files":count.files, "directories":count.directories, "sockets":count.sockets,
        "file_bytes":count.file_bytes.to_string()
    })).collect::<Vec<_>>();
    Ok(json!({"version":1,"ok":true,"result":{
        "root":ROOT,"destructive":true,"managedAccountRemoval":result["managedAccountRemoval"],
        "outsideRootAuditComplete":false,"forensicErasureProven":false,"scopes":scopes
    }}))
}

pub(super) fn removal_reply(value: &Value) -> Result<Value, &'static str> {
    if value["version"] != 1 || !value.as_object().is_some_and(|fields| fields.len() == 3) {
        return Err(REMOVAL_UNCERTAIN);
    }
    if value["ok"] == false {
        let error = &value["error"];
        if !error.as_object().is_some_and(|fields| fields.len() == 2) {
            return Err(REMOVAL_UNCERTAIN);
        }
        // These exact owner replies occur before the one-use grant is consumed.
        let (code, message) = match (error["code"].as_str(), error["message"].as_str()) {
            (Some("qualification_required"), Some("Operation has not passed host qualification")) =>
                ("qualification_required", "The host policy does not qualify removal."),
            (Some("authorization_required"), Some("Exact request needs one-time host operator authorization" | "Host authorization expired or differs")) =>
                ("authorization_required", "A matching one-use host grant is required for removal."),
            _ => return Err(REMOVAL_UNCERTAIN),
        };
        return Ok(json!({"version":1,"ok":false,"error":{"code":code,"message":message}}));
    }
    let result = &value["result"];
    if value["ok"] != true || !result.as_object().is_some_and(|fields| fields.len() == 5)
        || result["removed_root"] != ROOT || result["logical_removal_verified"] != true
        || result["forensic_erasure_proven"] != false || result["backup_created"] != false
        || !result["remaining_host_managed_records"].as_array().is_some_and(Vec::is_empty) {
        return Err(REMOVAL_UNCERTAIN);
    }
    Ok(json!({"version":1,"ok":true,"result":{
        "schema":"nodenetwork-logical-removal-v1","root":ROOT,"logical_removal_verified":true,
        "forensic_erasure_proven":false,"backup_created":false,"remaining_attributed_records":0
    }}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::node_controller::Request;

    fn fixture() -> Value {
        json!({"version":1,"ok":true,"result":{
            "root":ROOT,"destructive":true,"managedAccountRemoval":true,"forensicErasureProven":false,
            "inventory":{"root":ROOT,"outsideRootAuditComplete":false,"members":[
                {"path":"data","type":"directory","bytes":4096},
                {"path":"data/private-a","type":"file","bytes":u64::MAX},
                {"path":"data/private-b","type":"file","bytes":1},
                {"path":"keys/private-key","type":"file","bytes":2},
                {"path":"recovery/private-backup","type":"file","bytes":3},
                {"path":"run/private-socket","type":"socket","bytes":4096}
            ]}
        }})
    }

    #[test]
    fn preflight_is_empty_and_removal_keeps_its_typed_confirmation() {
        let mut request = Request {
            version: 1,
            operation: "uninstall_preflight".into(),
            parameters: json!({}),
        };
        assert_eq!(request.validate(), Ok(false));
        request.parameters = json!({"confirmation":ROOT});
        assert!(request.validate().is_err());
        request.operation = "uninstall".into();
        assert_eq!(request.validate(), Ok(true));
    }

    #[test]
    fn projects_exact_file_bytes_per_area_and_keeps_member_paths_private() {
        let result = reply(&fixture()).unwrap();
        assert_eq!(result["result"]["managedAccountRemoval"], true);
        assert_eq!(result["result"]["outsideRootAuditComplete"], false);
        assert_eq!(
            result["result"]["scopes"][0],
            json!({
                "id":"chain_data","files":2,"directories":1,"sockets":0,"file_bytes":"18446744073709551616"
            })
        );
        assert_eq!(result["result"]["scopes"][1]["file_bytes"], "2");
        assert_eq!(result["result"]["scopes"][2]["file_bytes"], "3");
        assert_eq!(result["result"]["scopes"][3]["sockets"], 1);
        assert_eq!(result["result"]["scopes"][3]["file_bytes"], "0");
        assert!(!result.to_string().contains("private"));
    }

    #[test]
    fn rejects_contradictory_scope_unsafe_members_and_noncanonical_roots() {
        for (path, data) in [
            ("/result/root", json!("/opt/synergy")),
            ("/result/inventory/root", json!("/opt/synergy")),
            ("/result/inventory/outsideRootAuditComplete", json!(true)),
            ("/result/forensicErasureProven", json!(true)),
            ("/result/inventory/members/1/path", json!("../private")),
            ("/result/inventory/members/1/path", json!("data/private-b")),
            ("/result/inventory/members/1/type", json!("link")),
            ("/result/inventory/members/1/bytes", json!(-1)),
            (
                "/result/inventory/members",
                json!(vec![Value::Null; 20_001]),
            ),
        ] {
            let mut value = fixture();
            *value.pointer_mut(path).unwrap() = data;
            assert_eq!(reply(&value), Err(UNSUPPORTED), "{path}");
        }
        let refused = json!({"version":1,"ok":false,"error":{"message":"private fixture"}});
        assert!(!reply(&refused).unwrap_err().contains("private fixture"));
    }

    #[test]
    fn reviewed_removal_rejects_mismatched_root_forensic_claims_and_remaining_records() {
        let owner = json!({"version":1,"ok":true,"result":{"removed_root":ROOT,"logical_removal_verified":true,
            "forensic_erasure_proven":false,"backup_created":false,"remaining_host_managed_records":[]}});
        assert_eq!(removal_reply(&owner).unwrap()["result"], json!({
            "schema":"nodenetwork-logical-removal-v1","root":ROOT,"logical_removal_verified":true,
            "forensic_erasure_proven":false,"backup_created":false,"remaining_attributed_records":0
        }));
        for (field, value) in [
            ("removed_root", json!("/opt/synergy")),
            ("logical_removal_verified", json!(false)),
            ("forensic_erasure_proven", json!(true)),
            ("backup_created", json!(true)),
            ("remaining_host_managed_records", json!(["private fixture"])),
            ("remaining_host_managed_records", Value::Null),
            ("unrelated", json!(true)),
        ] {
            let mut altered = owner.clone();
            altered["result"][field] = value;
            assert_eq!(removal_reply(&altered), Err(REMOVAL_UNCERTAIN), "{field}");
        }
        let unexpected = json!({"version":1,"ok":false,"error":{"code":"authorization_required","message":"private fixture"}});
        assert_eq!(removal_reply(&unexpected), Err(REMOVAL_UNCERTAIN));
    }
}
