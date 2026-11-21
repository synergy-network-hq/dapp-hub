export type ForgeFileLanguage = "synq" | "json" | "toml" | "markdown" | "text";

export type ForgeWorkspaceFile = {
  id: string;
  path: string;
  content: string;
  savedContent: string;
  language: ForgeFileLanguage;
  generated?: boolean;
  readOnly?: boolean;
  modifiedAt: string;
};

export type ForgeProject = {
  schemaVersion: 2;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  trusted: boolean;
  source: "local" | "template" | "folder" | "archive" | "git";
  files: ForgeWorkspaceFile[];
  baseline: Record<string, string>;
  openTabs: string[];
  activeFile: string | null;
  buildHistory?: ForgeBuild[];
  testHistory?: ForgeTestRun[];
};

export type ForgeDiagnostic = {
  severity: "error" | "warning" | "info";
  message: string;
  line?: number | null;
  column?: number | null;
  source: string;
  file: string;
};

export type SynqAbiMethod = {
  mutability: "read" | "write" | string;
  name: string;
  params: Array<{ name: string; type: string; indexed?: boolean }>;
  returns: string[];
  selector: string;
  visibility: string;
};

export type SynqArtifacts = {
  abi: {
    abi_version: string;
    contract: string;
    methods: SynqAbiMethod[];
    events: unknown[];
    errors: unknown[];
    security_requirements: Record<string, string>;
    state_schema: Array<{ name: string; type: string; visibility: string }>;
  };
  manifest: Record<string, unknown>;
  bytecodeHex: string;
  solidityCompatibility: string;
  hashes: {
    abi: string;
    bytecode: string;
    manifest: string;
    source: string;
    storageSchema: string;
  };
};

export type SynqCompileResult = {
  ok: boolean;
  compilerVersion: string;
  diagnostics: ForgeDiagnostic[];
  artifacts: SynqArtifacts | null;
  durationMs: number;
  file: string;
};

export type ForgeBuild = {
  id: string;
  status: "running" | "succeeded" | "failed";
  startedAt: string;
  completedAt?: string;
  file: string;
  compilerVersion?: string;
  durationMs?: number;
  artifacts?: SynqArtifacts;
  diagnostics: ForgeDiagnostic[];
};

export type ForgeTestResult = {
  id: string;
  name: string;
  file: string;
  status: "passed" | "failed";
  durationMs: number;
  message: string;
};

export type ForgeTestRun = {
  id: string;
  startedAt: string;
  completedAt: string;
  status: "passed" | "failed";
  passed: number;
  failed: number;
  results: ForgeTestResult[];
};

export type ForgeTaskLog = {
  id: string;
  at: string;
  level: "command" | "info" | "success" | "warning" | "error";
  text: string;
};

export type ForgeChange = {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
};
