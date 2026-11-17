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
    println!("cargo:rerun-if-env-changed=SYNERGY_NODENETWORK_QUALIFICATION_BARE_ROLLBACK_MANIFEST_SHA256");
    if let Ok(pin)=std::env::var("SYNERGY_NODENETWORK_QUALIFICATION_BARE_ROLLBACK_MANIFEST_SHA256"){
        assert_eq!(std::env::var("PROFILE").as_deref(),Ok("debug"),"Bare rollback qualification is forbidden in production");
        assert!(pin.len()==64&&pin.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)),"Invalid bare rollback manifest SHA256");
        println!("cargo:rustc-env=SYNERGY_NODENETWORK_QUALIFICATION_BARE_ROLLBACK_MANIFEST_SHA256={pin}");
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
    println!("cargo:rerun-if-env-changed=SYNERGY_NODENETWORK_QUALIFICATION_HOST_PINS");
    if let Ok(pins)=std::env::var("SYNERGY_NODENETWORK_QUALIFICATION_HOST_PINS"){
        assert_eq!(std::env::var("PROFILE").as_deref(),Ok("debug"),"Engineering host pin set forbidden in production");
        let lines:Vec<_>=pins.lines().collect();let mut endpoints=std::collections::BTreeSet::new();
        assert!(!lines.is_empty()&&lines.len()<=5&&pins.len()<=4096&&!pins.ends_with('\n')&&!pins.contains('\r'),"At most five bounded exact host pins required");
        for line in lines{let f:Vec<_>=line.split_whitespace().collect();assert!(f.len()==3&&f.join(" ")==line&&f[0]==f[0].to_ascii_lowercase()&&!f[0].contains([',','*','?','|','!'])&&endpoints.insert(f[0])&&f[1]=="ssh-ed25519"&&f[2].len()==68&&f[2].bytes().all(|b|b.is_ascii_alphanumeric()||b"+/".contains(&b)),"Invalid or ambiguous exact SSH host pin");}
        if let Ok(single)=std::env::var("SYNERGY_NODENETWORK_QUALIFICATION_HOST_PIN"){assert!(pins.lines().any(|line|line==single),"Legacy single host pin must belong to configured fleet set");}
        println!("cargo:rustc-env=SYNERGY_NODENETWORK_QUALIFICATION_HOST_PINS={}",pins.replace('\n',"\x1e"));
    }

}
