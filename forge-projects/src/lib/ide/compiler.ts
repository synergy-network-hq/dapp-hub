import type {
  ForgeDiagnostic,
  SynqArtifacts,
  SynqCompileResult,
} from "./types";

type RawCompileResult = {
  ok: boolean;
  compilerVersion: string;
  diagnostics: Array<Omit<ForgeDiagnostic, "file">>;
  artifacts?: SynqArtifacts;
};

type SynqCompilerModule = {
  compileSynq: (source: string) => RawCompileResult;
};

let compilerPromise: Promise<SynqCompilerModule> | null = null;

async function loadCompiler() {
  if (!compilerPromise) {
    compilerPromise = import("./generated/synq_compiler.js").then(
      async (generatedModule) => {
        await generatedModule.default({
          module_or_path: new URL("../../../assets/compiler/synq_compiler_bg.wasm",import.meta.url).href,
        });
        return generatedModule as SynqCompilerModule;
      },
    );
  }
  return compilerPromise;
}

export async function compileSynqSource(
  source: string,
  file: string,
): Promise<SynqCompileResult> {
  const startedAt = performance.now();
  try {
    const compiler = await loadCompiler();
    const result = compiler.compileSynq(source);
    return {
      ok: result.ok,
      compilerVersion: result.compilerVersion,
      diagnostics: result.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        file,
      })),
      artifacts: result.artifacts || null,
      durationMs: Math.max(1, Math.round(performance.now() - startedAt)),
      file,
    };
  } catch (error) {
    return {
      ok: false,
      compilerVersion: "unavailable",
      diagnostics: [
        {
          severity: "error",
          message:
            error instanceof Error
              ? `SynQ compiler could not start: ${error.message}`
              : "SynQ compiler could not start.",
          source: "ForgeIDE compiler loader",
          file,
        },
      ],
      artifacts: null,
      durationMs: Math.max(1, Math.round(performance.now() - startedAt)),
      file,
    };
  }
}

export async function warmSynqCompiler() {
  await loadCompiler();
}
