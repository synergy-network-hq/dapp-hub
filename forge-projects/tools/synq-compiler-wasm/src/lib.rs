use serde::Serialize;
use wasm_bindgen::prelude::*;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Diagnostic {
    severity: &'static str,
    message: String,
    line: Option<usize>,
    column: Option<usize>,
    source: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactHashes {
    abi: String,
    bytecode: String,
    manifest: String,
    source: String,
    storage_schema: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Artifacts {
    abi: serde_json::Value,
    manifest: serde_json::Value,
    bytecode_hex: String,
    solidity_compatibility: String,
    hashes: ArtifactHashes,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CompileResponse {
    ok: bool,
    compiler_version: String,
    diagnostics: Vec<Diagnostic>,
    artifacts: Option<Artifacts>,
}

fn compiler_version() -> String {
    let version = compiler::get_compiler_version();
    format!("{}.{}.{}", version.major, version.minor, version.patch)
}

fn failure(diagnostics: Vec<Diagnostic>) -> JsValue {
    serialize(&CompileResponse {
        ok: false,
        compiler_version: compiler_version(),
        diagnostics,
        artifacts: None,
    })
}

fn serialize<T: Serialize>(value: &T) -> JsValue {
    value
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .expect("SynQ compiler response must serialize")
}

#[wasm_bindgen(js_name = compileSynq)]
pub fn compile_synq(source: &str) -> JsValue {
    let (_, ast) = match compiler::parse(source) {
        Ok(parsed) => parsed,
        Err(error) => {
            let (line, column) = match error.line_col {
                pest::error::LineColLocation::Pos((line, column))
                | pest::error::LineColLocation::Span((line, column), _) => {
                    (Some(line), Some(column))
                }
            };
            return failure(vec![Diagnostic {
                severity: "error",
                message: error.variant.message().to_string(),
                line,
                column,
                source: "SynQ parser",
            }]);
        }
    };

    if let Err(errors) = compiler::analyze(&ast) {
        return failure(
            errors
                .into_iter()
                .map(|error| Diagnostic {
                    severity: "error",
                    message: error.message,
                    line: error.line,
                    column: error.column,
                    source: "SynQ semantic analyzer",
                })
                .collect(),
        );
    }

    let bytecode = match compiler::CodeGenerator::new().generate_stateful(&ast) {
        Ok(bytecode) => bytecode,
        Err(message) => {
            return failure(vec![Diagnostic {
                severity: "error",
                message,
                line: None,
                column: None,
                source: "SynQ code generator",
            }]);
        }
    };

    let solidity_compatibility = match compiler::SolidityGenerator::new().generate(&ast) {
        Ok(output) => output,
        Err(message) => {
            return failure(vec![Diagnostic {
                severity: "error",
                message,
                line: None,
                column: None,
                source: "SynQ compatibility generator",
            }]);
        }
    };

    let bundle = match compiler::ArtifactBundle::generate(source, &ast, bytecode) {
        Ok(bundle) => bundle,
        Err(message) => {
            return failure(vec![Diagnostic {
                severity: "error",
                message,
                line: None,
                column: None,
                source: "SynQ artifact generator",
            }]);
        }
    };

    let abi = serde_json::to_value(&bundle.abi).expect("ABI must serialize");
    let manifest = serde_json::to_value(&bundle.manifest).expect("manifest must serialize");
    let response = CompileResponse {
        ok: true,
        compiler_version: compiler_version(),
        diagnostics: Vec::new(),
        artifacts: Some(Artifacts {
            abi,
            manifest,
            bytecode_hex: hex::encode(&bundle.bytecode),
            solidity_compatibility,
            hashes: ArtifactHashes {
                abi: bundle.hashes.abi_hash,
                bytecode: bundle.hashes.bytecode_hash,
                manifest: bundle.hashes.manifest_hash,
                source: bundle.hashes.source_hash,
                storage_schema: bundle.hashes.storage_schema_hash,
            },
        }),
    };
    serialize(&response)
}
