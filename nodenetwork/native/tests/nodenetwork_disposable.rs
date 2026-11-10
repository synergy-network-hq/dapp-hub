//! Opt-in, actual controller lifecycle qualification. Never targets a live fleet.
use nodenetwork_native::node_controller;
use serde_json::{json,Value};
use sha2::{Digest,Sha256};

#[test]
#[ignore="Requires an explicitly approved disposable host grant, authenticated agent and isolated debug host pin"]
fn reviewed_disposable_software_operation_uses_the_production_bridge(){
    let target_json=std::env::var("NODENETWORK_TEST_TARGET").expect("explicit disposable target required");
    let request:node_controller::Request=serde_json::from_str(&std::env::var("NODENETWORK_TEST_REQUEST").expect("exact approved request required")).unwrap();
    assert!(["install","uninstall"].contains(&request.operation.as_str()));
    request.validate().unwrap();
    let directory=std::path::PathBuf::from(std::env::var_os("NODENETWORK_TEST_CONTROL_DIR").expect("existing Portal control directory required"));
    let host=serde_json::from_str::<Value>(&target_json).unwrap();
    assert_eq!(host["host"],"127.0.0.1");assert_eq!(host["port"],22280);
    let socket=directory.join(format!("{:x}",Sha256::digest(b"127.0.0.1:22280"))[..24].to_string());
    struct Close(std::path::PathBuf);impl Drop for Close{fn drop(&mut self){let _=std::process::Command::new("/usr/bin/ssh").arg("-S").arg(&self.0).args(["-O","exit","--","127.0.0.1"]).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status();}}
    let _close=Close(socket);
    tauri::async_runtime::block_on(async {
        let inventory=node_controller::execute(serde_json::from_str(&target_json).unwrap(),node_controller::Request{version:1,operation:"inventory".into(),parameters:json!({})},&directory).await.unwrap();
        assert_eq!(inventory["ok"],true);
        assert_eq!(inventory["result"]["root"],"/opt/Synergy");
        assert!(!inventory["result"]["members"].as_array().unwrap().is_empty());
        let result=node_controller::execute(serde_json::from_str(&target_json).unwrap(),request,&directory).await.unwrap();
        assert_eq!(result["ok"],true,"the exact host-authorized software operation must complete");
        println!("Reviewed software operation completed through the production native controller; custody and consensus activation were not requested.");
    });
}
