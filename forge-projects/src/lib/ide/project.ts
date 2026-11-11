import JSZip from "jszip";
import { SYNQ_TEMPLATE_FILES } from "../synq";
import type {
  ForgeChange,
  ForgeFileLanguage,
  ForgeProject,
  ForgeWorkspaceFile,
} from "./types";
import { randomId } from "./id";

const SECRET_FILE_PATTERN =
  /(^|\/)(\.env(?:\.|$)|.*(?:private|secret|seed|mnemonic|keystore).*)/i;
const BINARY_EXTENSION_PATTERN =
  /\.(?:png|jpe?g|gif|webp|ico|zip|gz|tar|pdf|woff2?|ttf|otf|exe|dll|dylib|so|wasm)$/i;
const IGNORED_PART_PATTERN =
  /(^|\/)(?:\.git|node_modules|dist|build|target|coverage|\.next|\.vinext)(\/|$)/;

export function languageForPath(path: string): ForgeFileLanguage {
  if (path.endsWith(".synq")) return "synq";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".toml")) return "toml";
  if (path.endsWith(".md")) return "markdown";
  return "text";
}

export function normalizeProjectPath(path: string) {
  return path
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("/");
}

export function makeWorkspaceFile(
  path: string,
  content: string,
  options: Pick<ForgeWorkspaceFile, "generated" | "readOnly"> = {},
): ForgeWorkspaceFile {
  const normalized = normalizeProjectPath(path);
  const now = new Date().toISOString();
  return {
    id: randomId(),
    path: normalized,
    content,
    savedContent: content,
    language: languageForPath(normalized),
    modifiedAt: now,
    ...options,
  };
}

const starterTests = JSON.stringify(
  {
    version: 1,
    contract: "contracts/Counter.synq",
    tests: [
      { name: "publishes increment", assertion: "abi-method", value: "increment" },
      { name: "publishes get", assertion: "abi-method", value: "get" },
      { name: "declares counter state", assertion: "state-field", value: "counter" },
      { name: "targets Testnet v3 chain 1266", assertion: "manifest-chain", value: 1266 },
      { name: "produces bytecode", assertion: "bytecode-nonempty", value: true },
    ],
  },
  null,
  2,
);

export function createStarterProject(id = "local-counter"): ForgeProject {
  const now = new Date().toISOString();
  const files = [
    makeWorkspaceFile(
      "contracts/Counter.synq",
      SYNQ_TEMPLATE_FILES["contracts/Counter.synq"],
    ),
    makeWorkspaceFile("tests/Counter.test.json", starterTests),
    makeWorkspaceFile("synq.toml", SYNQ_TEMPLATE_FILES["synq.toml"]),
    makeWorkspaceFile("README.md", SYNQ_TEMPLATE_FILES["README.md"]),
  ];
  return {
    schemaVersion: 2,
    id,
    name: "Counter Starter",
    createdAt: now,
    updatedAt: now,
    trusted: true,
    source: "template",
    files,
    baseline: Object.fromEntries(files.map((file) => [file.path, file.content])),
    openTabs: ["contracts/Counter.synq"],
    activeFile: "contracts/Counter.synq",
    buildHistory: [],
    testHistory: [],
  };
}

export function createBlankProject(name: string): ForgeProject {
  const now = new Date().toISOString();
  const safeName = name.trim() || "Untitled SynQ Project";
  const files = [
    makeWorkspaceFile(
      "synq.toml",
      `[package]\nname = "${safeName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}"\n\n[network]\nid = "synergy-testnet-v3"\nchain_id = 1266\n\n[runtime]\ntarget = "AIVM"\n`,
    ),
    makeWorkspaceFile(
      "README.md",
      `# ${safeName}\n\nCreated locally in ForgeIDE v3.\n`,
    ),
  ];
  return {
    schemaVersion: 2,
    id: `local-${randomId()}`,
    name: safeName,
    createdAt: now,
    updatedAt: now,
    trusted: true,
    source: "local",
    files,
    baseline: Object.fromEntries(files.map((file) => [file.path, file.content])),
    openTabs: ["README.md"],
    activeFile: "README.md",
    buildHistory: [],
    testHistory: [],
  };
}

export async function projectFromFileList(
  entries: File[],
  name: string,
): Promise<{ project: ForgeProject; warnings: string[] }> {
  const warnings: string[] = [];
  const accepted: ForgeWorkspaceFile[] = [];
  const relativePaths = entries.map(
    (entry) =>
      (entry as File & { webkitRelativePath?: string }).webkitRelativePath ||
      entry.name,
  );
  const directoryImport =
    relativePaths.length > 0 &&
    entries.every((entry, index) => relativePaths[index] !== entry.name);
  const roots = new Set(
    relativePaths
      .filter((path) => path.includes("/"))
      .map((path) => normalizeProjectPath(path).split("/")[0]),
  );
  const sharedDirectoryRoot =
    directoryImport && roots.size === 1 ? [...roots][0] : null;
  for (const entry of entries) {
    const originalPath = normalizeProjectPath(
      (entry as File & { webkitRelativePath?: string }).webkitRelativePath ||
        entry.name,
    );
    const path =
      sharedDirectoryRoot && originalPath.startsWith(`${sharedDirectoryRoot}/`)
        ? originalPath.slice(sharedDirectoryRoot.length + 1)
        : originalPath;
    if (!path || IGNORED_PART_PATTERN.test(path)) continue;
    if (SECRET_FILE_PATTERN.test(path)) {
      warnings.push(`Skipped sensitive-looking file: ${path}`);
      continue;
    }
    if (entry.size > 1_000_000 || BINARY_EXTENSION_PATTERN.test(path)) {
      warnings.push(`Skipped binary or oversized file: ${path}`);
      continue;
    }
    accepted.push(makeWorkspaceFile(path, await entry.text()));
  }
  if (!accepted.length) throw new Error("No safe text files were found in that selection.");
  const now = new Date().toISOString();
  return {
    project: {
      schemaVersion: 2,
      id: `import-${randomId()}`,
      name: name.trim() || "Imported Forge Project",
      createdAt: now,
      updatedAt: now,
      trusted: false,
      source: "folder",
      files: accepted,
      baseline: Object.fromEntries(accepted.map((file) => [file.path, file.content])),
      openTabs: [accepted[0].path],
      activeFile: accepted[0].path,
      buildHistory: [],
      testHistory: [],
    },
    warnings,
  };
}

export async function projectFromZip(
  data: ArrayBuffer,
  name = "Imported Forge Project",
): Promise<{ project: ForgeProject; warnings: string[] }> {
  if (data.byteLength > 10_000_000) {
    throw new Error("ZIP imports are limited to 10 MB.");
  }
  const zip = await JSZip.loadAsync(data);
  const files: File[] = [];
  const items = Object.values(zip.files).filter((item) => !item.dir);
  if (items.length > 2_000) {
    throw new Error("ZIP imports are limited to 2,000 files.");
  }
  const warnings: string[] = [];
  const itemPaths = items.map((item) => normalizeProjectPath(item.name));
  const roots = new Set(
    itemPaths
      .filter((path) => path.includes("/"))
      .map((path) => path.split("/")[0]),
  );
  const allHaveRoot = itemPaths.every((path) => path.includes("/"));
  const sharedRoot = allHaveRoot && roots.size === 1 ? [...roots][0] : null;
  let importedBytes = 0;
  for (const item of items) {
    if (item.dir) continue;
    const originalPath = normalizeProjectPath(item.name);
    const path =
      sharedRoot && originalPath.startsWith(`${sharedRoot}/`)
        ? originalPath.slice(sharedRoot.length + 1)
        : originalPath;
    if (!path || IGNORED_PART_PATTERN.test(path)) continue;
    if (SECRET_FILE_PATTERN.test(path)) {
      warnings.push(`Skipped sensitive-looking file: ${path}`);
      continue;
    }
    if (BINARY_EXTENSION_PATTERN.test(path)) {
      warnings.push(`Skipped binary file: ${path}`);
      continue;
    }
    const declaredSize = (
      item as unknown as { _data?: { uncompressedSize?: number } }
    )._data?.uncompressedSize;
    if (!Number.isSafeInteger(declaredSize)||declaredSize===undefined||declaredSize<0||declaredSize>1_000_000) {
      warnings.push(`Skipped oversized file: ${path}`);
      continue;
    }
    if(importedBytes+declaredSize>25000000)throw Error("ZIP declares more than25 MB of source data.");
    const content=await new Promise<Uint8Array>((resolve,reject)=>{
      const chunks:Uint8Array[]=[];let length=0,failed=false;
      const stream=(item as unknown as {internalStream(type:"uint8array"):JSZip.JSZipStreamHelper<Uint8Array>}).internalStream("uint8array");
      stream.on("data",chunk=>{if(failed)return;if(length+chunk.byteLength>declaredSize||length+chunk.byteLength>1000000){failed=true;stream.pause();reject(Error("ZIP entry exceeds its bounded declared size."));return;}length+=chunk.byteLength;chunks.push(chunk);});
      stream.on("error",error=>{failed=true;reject(error);});
      stream.on("end",()=>{if(failed)return;if(length!==declaredSize){reject(Error("ZIP entry size does not match its declaration."));return;}const data=new Uint8Array(length);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.byteLength;}resolve(data);});
      stream.resume();
    });
    importedBytes += content.byteLength;
    if (content.byteLength > 1_000_000) {
      warnings.push(`Skipped oversized file: ${path}`);
      continue;
    }
    if (importedBytes > 25_000_000) {
      throw new Error("ZIP expands beyond the 25 MB safe import limit.");
    }
    const fileBytes = content.buffer.slice(
      content.byteOffset,
      content.byteOffset + content.byteLength,
    ) as ArrayBuffer;
    const file = new File([fileBytes], path, { type: "text/plain" });
    Object.defineProperty(file, "webkitRelativePath", { value: path });
    files.push(file);
  }
  const imported = await projectFromFileList(files, name);
  imported.project.source = "archive";
  imported.warnings.unshift(...warnings);
  return imported;
}

export async function exportProjectZip(project: ForgeProject) {
  const zip = new JSZip();
  for (const file of project.files) {
    zip.file(file.path, file.content);
  }
  zip.file(
    ".forge/workspace.json",
    JSON.stringify(
      {
        schemaVersion: project.schemaVersion,
        projectId: project.id,
        name: project.name,
        exportedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  zip.file(
    ".forge/build-history.json",
    JSON.stringify(project.buildHistory || [], null, 2),
  );
  zip.file(
    ".forge/test-history.json",
    JSON.stringify(project.testHistory || [], null, 2),
  );
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

export function calculateChanges(project: ForgeProject): ForgeChange[] {
  const current = new Map(project.files.map((file) => [file.path, file.content]));
  const paths = new Set([...Object.keys(project.baseline), ...current.keys()]);
  const changes: ForgeChange[] = [];
  for (const path of [...paths].sort()) {
      const before = project.baseline[path];
      const after = current.get(path);
      if (before === after) continue;
      if (before === undefined) {
        changes.push({
          path,
          status: "added",
          additions: after?.split("\n").length || 0,
          deletions: 0,
        });
        continue;
      }
      if (after === undefined) {
        changes.push({
          path,
          status: "deleted",
          additions: 0,
          deletions: before.split("\n").length,
        });
        continue;
      }
      const beforeLines = before.split("\n");
      const afterLines = after.split("\n");
      let shared = 0;
      const beforeSet = new Set(beforeLines);
      for (const line of afterLines) if (beforeSet.has(line)) shared += 1;
      changes.push({
        path,
        status: "modified",
        additions: Math.max(0, afterLines.length - shared),
        deletions: Math.max(0, beforeLines.length - shared),
      });
  }
  return changes;
}

export function isSafeNewPath(path: string) {
  const normalized = normalizeProjectPath(path);
  return Boolean(
    normalized &&
      !SECRET_FILE_PATTERN.test(normalized) &&
      !IGNORED_PART_PATTERN.test(normalized),
  );
}
