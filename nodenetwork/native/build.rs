fn main() {
    let engine=std::env::var("SYNERGY_NODE_ENGINE_ROOT").unwrap_or_else(|_|"/Volumes/PortableSSD/02-Synergy-Network/01-Core-Protocol/node-platform/tools/linux-node".into());
    let source=std::path::Path::new(&engine).join("bootstrap.py");
    assert!(source.is_file(),"Build requires canonical NodeNetwork bootstrap.py; set SYNERGY_NODE_ENGINE_ROOT to the qualified shared engine.");
    println!("cargo:rerun-if-env-changed=SYNERGY_NODE_ENGINE_ROOT");
    println!("cargo:rerun-if-changed={}",source.display());
    println!("cargo:rustc-env=SYNERGY_NODE_ENGINE_ROOT={}",engine);
    println!("cargo:rerun-if-changed={}",std::path::Path::new(&engine).join("vpn_authorization.py").display());
    println!("cargo:rerun-if-env-changed=SYNERGY_NODENETWORK_QUALIFICATION_VPN_PROVIDER_SHA256");
    if let Ok(pin)=std::env::var("SYNERGY_NODENETWORK_QUALIFICATION_VPN_PROVIDER_SHA256"){
        assert_eq!(std::env::var("PROFILE").as_deref(),Ok("debug"),"VPN engineering authority is forbidden in production");
        assert!(pin.len()==64&&pin.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)),"Invalid VPN provider policy pin");
        println!("cargo:rustc-env=SYNERGY_NODENETWORK_QUALIFICATION_VPN_PROVIDER_SHA256={pin}");
    }
    println!("cargo:rerun-if-env-changed=SYNERGY_NODENETWORK_QUALIFICATION_MANIFEST_SHA256");
    if let Ok(pin)=std::env::var("SYNERGY_NODENETWORK_QUALIFICATION_MANIFEST_SHA256"){
        assert_eq!(std::env::var("PROFILE").as_deref(),Ok("debug"),"Isolated qualification pin is forbidden in production builds");
        assert!(pin.len()==64&&pin.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)),"Invalid qualification manifest SHA-256");
        println!("cargo:rustc-env=SYNERGY_NODENETWORK_QUALIFICATION_MANIFEST_SHA256={}",pin);
    }
    println!("cargo:rerun-if-env-changed=SYNERGY_NODENETWORK_QUALIFICATION_AUTHORIZATION_SHA256");
    if let Ok(pin)=std::env::var("SYNERGY_NODENETWORK_QUALIFICATION_AUTHORIZATION_SHA256"){
        assert_eq!(std::env::var("PROFILE").as_deref(),Ok("debug"),"Engineering operator authorization is forbidden in production builds");
        assert!(pin.len()==64&&pin.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)),"Invalid exact authorization SHA256");
        println!("cargo:rustc-env=SYNERGY_NODENETWORK_QUALIFICATION_AUTHORIZATION_SHA256={}",pin);
    }
    println!("cargo:rerun-if-env-changed=SYNERGY_NODENETWORK_QUALIFICATION_AUTHORIZATION_SHA256S");
    if let Ok(pins)=std::env::var("SYNERGY_NODENETWORK_QUALIFICATION_AUTHORIZATION_SHA256S"){
        assert_eq!(std::env::var("PROFILE").as_deref(),Ok("debug"),"Engineering authorization set is forbidden in production");
        let values:std::collections::BTreeSet<_>=pins.split(',').collect();
        if let Ok(single)=std::env::var("SYNERGY_NODENETWORK_QUALIFICATION_AUTHORIZATION_SHA256"){assert!(values.contains(single.as_str()),"Single authorization pin must belong to the bounded set");}
        assert!(!values.is_empty()&&values.len()<=5&&values.len()==pins.split(',').count()&&values.iter().all(|p|p.len()==64&&p.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))),"At most five distinct exact engineering document pins required");
        println!("cargo:rustc-env=SYNERGY_NODENETWORK_QUALIFICATION_AUTHORIZATION_SHA256S={}",pins);
    }
    println!("cargo:rerun-if-env-changed=SYNERGY_NODENETWORK_QUALIFICATION_HOST_PIN");
    if let Ok(pin)=std::env::var("SYNERGY_NODENETWORK_QUALIFICATION_HOST_PIN"){
        assert_eq!(std::env::var("PROFILE").as_deref(),Ok("debug"),"Isolated host pin is forbidden in production builds");
        let fields:Vec<_>=pin.split_whitespace().collect();
        assert!(fields.len()==3&&fields[0]=="[127.0.0.1]:22280"&&fields[1]=="ssh-ed25519"&&fields[2].bytes().all(|b|b.is_ascii_alphanumeric()||b"+/=".contains(&b)),"Only the exact authenticated disposable localhost host pin is allowed");
        println!("cargo:rustc-env=SYNERGY_NODENETWORK_QUALIFICATION_HOST_PIN={}",fields.join(" "));
    }
}
