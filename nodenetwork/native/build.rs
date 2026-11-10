fn main() {
    let engine=std::env::var("SYNERGY_NODE_ENGINE_ROOT").unwrap_or_else(|_|"/Volumes/PortableSSD/02-Synergy-Network/01-Core-Protocol/node-platform/tools/linux-node".into());
    let source=std::path::Path::new(&engine).join("bootstrap.py");
    assert!(source.is_file(),"Build requires canonical NodeNetwork bootstrap.py; set SYNERGY_NODE_ENGINE_ROOT to the qualified shared engine.");
    println!("cargo:rerun-if-env-changed=SYNERGY_NODE_ENGINE_ROOT");
    println!("cargo:rerun-if-changed={}",source.display());
    println!("cargo:rustc-env=SYNERGY_NODE_ENGINE_ROOT={}",engine);
    println!("cargo:rerun-if-env-changed=SYNERGY_NODENETWORK_QUALIFICATION_MANIFEST_SHA256");
    if let Ok(pin)=std::env::var("SYNERGY_NODENETWORK_QUALIFICATION_MANIFEST_SHA256"){
        assert_eq!(std::env::var("PROFILE").as_deref(),Ok("debug"),"Isolated qualification pin is forbidden in production builds");
        assert!(pin.len()==64&&pin.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)),"Invalid qualification manifest SHA-256");
        println!("cargo:rustc-env=SYNERGY_NODENETWORK_QUALIFICATION_MANIFEST_SHA256={}",pin);
    }
    println!("cargo:rerun-if-env-changed=SYNERGY_NODENETWORK_QUALIFICATION_HOST_PIN");
    if let Ok(pin)=std::env::var("SYNERGY_NODENETWORK_QUALIFICATION_HOST_PIN"){
        assert_eq!(std::env::var("PROFILE").as_deref(),Ok("debug"),"Isolated host pin is forbidden in production builds");
        let fields:Vec<_>=pin.split_whitespace().collect();
        assert!(fields.len()==3&&fields[0]=="[127.0.0.1]:22280"&&fields[1]=="ssh-ed25519"&&fields[2].bytes().all(|b|b.is_ascii_alphanumeric()||b"+/=".contains(&b)),"Only the exact authenticated disposable localhost host pin is allowed");
        println!("cargo:rustc-env=SYNERGY_NODENETWORK_QUALIFICATION_HOST_PIN={}",fields.join(" "));
    }
}
