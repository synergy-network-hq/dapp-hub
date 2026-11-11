"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compileSynqSource, warmSynqCompiler } from "../lib/ide/compiler";
import {
  calculateChanges,
  createBlankProject,
  createStarterProject,
  exportProjectZip,
  isSafeNewPath,
  makeWorkspaceFile,
  normalizeProjectPath,
  projectFromFileList,
  projectFromZip,
} from "../lib/ide/project";
import { listProjects, loadProject, saveProject } from "../lib/ide/storage";
import { randomId } from "../lib/ide/id";
import type {
  ForgeBuild,
  ForgeDiagnostic,
  ForgeProject,
  ForgeTaskLog,
  ForgeTestResult,
  ForgeTestRun,
  ForgeWorkspaceFile,
  SynqArtifacts,
} from "../lib/ide/types";

type CompilerStatus = "loading" | "ready" | "error";

type AbiTest = {
  name: string;
  assertion:
    | "abi-method"
    | "state-field"
    | "manifest-chain"
    | "bytecode-nonempty";
  value: string | number | boolean;
};

type AbiTestFile = {
  version: number;
  contract: string;
  tests: AbiTest[];
};

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}-${randomId()}`;

function projectIdFromPath(path: string) {
  return path.match(/\/workspace\/project\/([^/]+)/)?.[1] || null;
}

function fileFromPath(path: string) {
  const match = path.match(/\/file\/(.+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function generatedArtifactFiles(
  sourcePath: string,
  artifacts: SynqArtifacts,
): ForgeWorkspaceFile[] {
  const stem = sourcePath.split("/").at(-1)?.replace(/\.synq$/, "") || "contract";
  return [
    makeWorkspaceFile(
      `artifacts/${stem}.abi.json`,
      JSON.stringify(artifacts.abi, null, 2),
      { generated: true, readOnly: true },
    ),
    makeWorkspaceFile(
      `artifacts/${stem}.manifest.json`,
      JSON.stringify(artifacts.manifest, null, 2),
      { generated: true, readOnly: true },
    ),
    makeWorkspaceFile(
      `artifacts/${stem}.bytecode.hex`,
      artifacts.bytecodeHex,
      { generated: true, readOnly: true },
    ),
    makeWorkspaceFile(
      `artifacts/${stem}.sol`,
      artifacts.solidityCompatibility,
      { generated: true, readOnly: true },
    ),
  ];
}

function evaluateTest(test: AbiTest, artifacts: SynqArtifacts) {
  if (test.assertion === "abi-method") {
    return artifacts.abi.methods.some((method) => method.name === test.value);
  }
  if (test.assertion === "state-field") {
    return artifacts.abi.state_schema.some((field) => field.name === test.value);
  }
  if (test.assertion === "manifest-chain") {
    return Number(artifacts.manifest.required_chain_id) === Number(test.value);
  }
  if (test.assertion === "bytecode-nonempty") {
    return artifacts.bytecodeHex.length > 0 === Boolean(test.value);
  }
  return false;
}

function defaultReplaceRoute(path: string) { window.history.replaceState(null, "", path); }

export function useForgeWorkspace(initialPath: string, replaceRoute: (path: string) => void = defaultReplaceRoute) {
  const [project, setProject] = useState<ForgeProject | null>(() =>
    projectIdFromPath(initialPath) === "local-counter"
      ? createStarterProject()
      : null,
  );
  const [recentProjects, setRecentProjects] = useState<ForgeProject[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [compilerStatus, setCompilerStatus] = useState<CompilerStatus>("loading");
  const [diagnostics, setDiagnostics] = useState<ForgeDiagnostic[]>([]);
  const [builds, setBuilds] = useState<ForgeBuild[]>([]);
  const [testRuns, setTestRuns] = useState<ForgeTestRun[]>([]);
  const [taskLog, setTaskLog] = useState<ForgeTaskLog[]>([]);
  const [busyTask, setBusyTask] = useState<"build" | "check" | "test" | null>(null);
  const [notice, setNotice] = useState("");
  const persistTimer = useRef<number | null>(null);
  const currentProject=useRef(project);currentProject.current=project;
  const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const taskSnapshot=(value:ForgeProject)=>JSON.stringify([value.id,value.trusted,value.files.map(file=>[file.path,file.content])]);


  const appendLog = useCallback(
    (level: ForgeTaskLog["level"], text: string) => {
      setTaskLog((current) => [
        ...current.slice(-299),
        { id: id("log"), at: now(), level, text },
      ]);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      const requestedId = projectIdFromPath(initialPath);
      let loaded = requestedId ? await loadProject(requestedId) : null;
      if (!loaded && requestedId === "local-counter") {
        loaded = createStarterProject();
      }
      if (loaded) {
        const requestedFile = fileFromPath(initialPath);
        if (requestedFile && loaded.files.some((file) => file.path === requestedFile)) {
          loaded.activeFile = requestedFile;
          loaded.openTabs = [...new Set([...loaded.openTabs, requestedFile])];
        }
      }
      const recent = await listProjects();
      if (!cancelled) {
        setProject(loaded);
        setRecentProjects(recent);
        setBuilds(loaded?.buildHistory || []);
        setTestRuns(loaded?.testHistory || []);
        setHydrated(true);
        if (loaded?.files.some((file) => file.content !== file.savedContent)) {
          setNotice("Recovered unsaved editor buffers from the previous session.");
        }
      }
    };
    void hydrate().catch(()=>{if(!cancelled)setNotice('Saved workspace could not be read. Original project records are retained; recover device storage before reopening.');});
    warmSynqCompiler()
      .then(() => {
        if (!cancelled) setCompilerStatus("ready");
      })
      .catch((error) => {
        if (!cancelled) {
          setCompilerStatus("error");
          setNotice(
            error instanceof Error
              ? error.message
              : "The SynQ compiler could not be initialized.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [initialPath]);

  useEffect(() => {
    if (!project || !hydrated) return;
    if (persistTimer.current) window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      void saveProject({ ...project, updatedAt: now() }).catch((error) => setNotice(error instanceof Error ? error.message : "Local project save failed."));
    }, 250);
    return () => {
      if (persistTimer.current) window.clearTimeout(persistTimer.current);
    };
  }, [hydrated, project]);

  const activeFile = useMemo(
    () => project?.files.find((file) => file.path === project.activeFile) || null,
    [project],
  );
  const changes = useMemo(() => (project ? calculateChanges(project) : []), [project]);
  const dirtyCount = useMemo(
    () => project?.files.filter((file) => file.content !== file.savedContent).length || 0,
    [project],
  );

  const replaceProject = useCallback(async (next: ForgeProject) => {
    setProject(next);
    setBuilds(next.buildHistory || []);
    setTestRuns(next.testHistory || []);
    setRecentProjects((current) => [
      next,
      ...current.filter((project) => project.id !== next.id),
    ].slice(0, 10));
    await saveProject(next);
    const selected = next.activeFile
      ? `/file/${next.activeFile.split("/").map(encodeURIComponent).join("/")}`
      : "";
    replaceRoute(`/workspace/project/${next.id}${selected}`);
  }, [replaceRoute]);

  const openTemplate = useCallback(() => {
    const saving = replaceProject(createStarterProject());
    setDiagnostics([]);
    setBuilds([]);
    setTestRuns([]);
    setTaskLog([]);
    setNotice("Created the explicit Counter starter from the authoritative SynQ example.");
    return saving;
  }, [replaceProject]);

  const newProject = useCallback(
    (name: string) => {
      const saving = replaceProject(createBlankProject(name));
      setDiagnostics([]);
      setTaskLog([]);
      setNotice("Created a new local Forge project.");
      return saving;
    },
    [replaceProject],
  );

  const openRecent = useCallback(
    async (projectId: string) => {
      const loaded = await loadProject(projectId);
      if (!loaded) throw new Error("That recent project is no longer available.");
      await replaceProject(loaded);
      setNotice(`Opened ${loaded.name}.`);
    },
    [replaceProject],
  );

  const importFiles = useCallback(
    async (files: File[]) => {
      const imported = await projectFromFileList(
        files,
        files[0]?.webkitRelativePath?.split("/")[0] || "Imported Forge Project",
      );
      await replaceProject(imported.project);
      setNotice(
        imported.warnings.length
          ? `Imported in restricted mode. ${imported.warnings.join(" ")}`
          : "Imported in restricted mode. Review project trust before running tasks.",
      );
    },
    [replaceProject],
  );

  const importArchive = useCallback(
    async (file: File) => {
      if (file.size > 10_000_000) {
        throw new Error("ZIP imports are limited to 10 MB.");
      }
      const imported = await projectFromZip(await file.arrayBuffer(), file.name.replace(/\.zip$/i, ""));
      await replaceProject(imported.project);
      setNotice(
        imported.warnings.length
          ? `Archive imported in restricted mode. ${imported.warnings.join(" ")}`
          : "Archive imported in restricted mode. Review project trust before running tasks.",
      );
    },
    [replaceProject],
  );

  const exportProject = useCallback(async () => {
    if (!project) return;
    const blob = await exportProjectZip(project);
    downloadBlob(blob, `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.zip`);
    appendLog("success", `Exported ${project.files.length} project files.`);
  }, [appendLog, project]);

  const trustProject = useCallback(() => {
    setProject((current) => current ? { ...current, trusted: true, updatedAt: now() } : current);
    setNotice("Workspace trusted. Built-in Forge tasks are now enabled.");
  }, []);

  const openFile = useCallback((path: string) => {
    setProject((current) => {
      if (!current || !current.files.some((file) => file.path === path)) return current;
      return {
        ...current,
        activeFile: path,
        openTabs: [...new Set([...current.openTabs, path])],
        updatedAt: now(),
      };
    });
    if (project) {
      replaceRoute(`/workspace/project/${project.id}/file/${path.split("/").map(encodeURIComponent).join("/")}`);
    }
  }, [project, replaceRoute]);

  const closeTab = useCallback((path: string) => {
    setProject((current) => {
      if (!current) return current;
      const tabs = current.openTabs.filter((tab) => tab !== path);
      const activeFile =
        current.activeFile === path ? tabs.at(-1) || null : current.activeFile;
      return { ...current, openTabs: tabs, activeFile, updatedAt: now() };
    });
  }, []);

  const updateActiveFile = useCallback((content: string) => {
    setProject((current) => {
      if (!current?.activeFile) return current;
      return {
        ...current,
        updatedAt: now(),
        files: current.files.map((file) =>
          file.path === current.activeFile && !file.readOnly
            ? { ...file, content, modifiedAt: now() }
            : file,
        ),
      };
    });
  }, []);

  const saveActiveFile = useCallback(async () => {
    const current=currentProject.current;if(!current?.activeFile)return;
    const path=current.activeFile,file=current.files.find(value=>value.path===path);if(!file)return;
    const next:ForgeProject={...current,updatedAt:now(),files:current.files.map(value=>value.path===path?{...value,savedContent:file.content,modifiedAt:now()}:value)};
    await saveProject(next);
    if(!alive.current||currentProject.current?.id!==current.id)return;
    setProject(value=>value?.id===current.id?{...value,updatedAt:now(),files:value.files.map(entry=>entry.path===path?{...entry,savedContent:file.content}:entry)}:value);
    appendLog('success',`Saved ${path}.`);
  }, [appendLog]);

  const createFile = useCallback((path: string, content = "") => {
    const normalized = normalizeProjectPath(path);
    if (!project) throw new Error("Open a project first.");
    if (!isSafeNewPath(normalized)) throw new Error("Choose a safe project-relative path.");
    if (project.files.some((file) => file.path === normalized)) {
      throw new Error("A file already exists at that path.");
    }
    const file = makeWorkspaceFile(normalized, content);
    setProject((current) => current ? {
      ...current,
      files: [...current.files, file],
      openTabs: [...current.openTabs, normalized],
      activeFile: normalized,
      updatedAt: now(),
    } : current);
    appendLog("success", `Created ${normalized}.`);
  }, [appendLog, project]);

  const renameFile = useCallback((from: string, to: string) => {
    const normalized = normalizeProjectPath(to);
    if (!project || !isSafeNewPath(normalized)) throw new Error("Choose a safe project-relative path.");
    if (project.files.some((file) => file.path === normalized)) {
      throw new Error("A file already exists at that path.");
    }
    setProject((current) => current ? {
      ...current,
      files: current.files.map((file) =>
        file.path === from ? { ...file, path: normalized, modifiedAt: now() } : file,
      ),
      openTabs: current.openTabs.map((tab) => tab === from ? normalized : tab),
      activeFile: current.activeFile === from ? normalized : current.activeFile,
      updatedAt: now(),
    } : current);
    appendLog("success", `Renamed ${from} to ${normalized}.`);
  }, [appendLog, project]);

  const deleteFile = useCallback((path: string) => {
    setProject((current) => {
      if (!current) return current;
      const files = current.files.filter((file) => file.path !== path);
      const tabs = current.openTabs.filter((tab) => tab !== path);
      return {
        ...current,
        files,
        openTabs: tabs,
        activeFile: current.activeFile === path ? tabs.at(-1) || null : current.activeFile,
        updatedAt: now(),
      };
    });
    appendLog("warning", `Deleted ${path} from this local project.`);
  }, [appendLog]);

  const commitBaseline = useCallback(() => {
    setProject((current) => current ? {
      ...current,
      baseline: Object.fromEntries(current.files.map((file) => [file.path, file.content])),
      files: current.files.map((file) => ({ ...file, savedContent: file.content })),
      updatedAt: now(),
    } : current);
    appendLog("success", "Created a local source-control snapshot.");
  }, [appendLog]);

  const build = useCallback(async (mode: "build" | "check" = "build") => {
    if (!project) throw new Error("Open a project first.");
    if (!project.trusted) throw new Error("Trust the imported workspace before running tasks.");
    const sourceFile =
      (activeFile?.path.endsWith(".synq") ? activeFile : null) ||
      project.files.find((file) => file.path.startsWith("contracts/") && file.path.endsWith(".synq"));
    if (!sourceFile) throw new Error("No SynQ contract source file is available.");
    const submittedSnapshot=taskSnapshot(project);
    setBusyTask(mode);
    try{
    const buildId = id("build");
    const startedAt = now();
    const runningBuild: ForgeBuild = {
      id: buildId,
      status: "running",
      startedAt,
      file: sourceFile.path,
      diagnostics: [],
    };
    setBuilds((current) => [runningBuild, ...current].slice(0, 20));
    appendLog("command", `synq ${mode} ${sourceFile.path}`);
    const result = await compileSynqSource(sourceFile.content, sourceFile.path);
    if(!alive.current||!currentProject.current||taskSnapshot(currentProject.current)!==submittedSnapshot)throw Error("Workspace changed during compilation; result not applied.");
    setDiagnostics(result.diagnostics);
    const completed: ForgeBuild = {
      id: buildId,
      status: result.ok ? "succeeded" : "failed",
      startedAt,
      completedAt: now(),
      file: sourceFile.path,
      compilerVersion: result.compilerVersion,
      durationMs: result.durationMs,
      artifacts: result.artifacts || undefined,
      diagnostics: result.diagnostics,
    };
    const current=currentProject.current!;
    const generated=result.ok&&result.artifacts&&mode==='build'?generatedArtifactFiles(sourceFile.path,result.artifacts):[];
    const generatedPaths=new Set(generated.map(file=>file.path));
    const next:ForgeProject={...current,buildHistory:[completed,...(current.buildHistory||[]).filter(entry=>entry.id!==buildId)].slice(0,20),files:[...current.files.filter(file=>!generatedPaths.has(file.path)),...generated],updatedAt:now()};
    await saveProject(next);
    if(!alive.current||currentProject.current?.id!==project.id)throw Error('Workspace changed before build publication.');
    setProject(next);setBuilds(next.buildHistory||[]);
    if(result.ok&&result.artifacts&&mode==='build'){
      appendLog("success", `Build succeeded with SynQ ${result.compilerVersion} in ${result.durationMs} ms.`);
      appendLog("info", `Bytecode SHA-256 ${result.artifacts.hashes.bytecode}`);
    } else if (result.ok) {
      appendLog("success", `Check succeeded with SynQ ${result.compilerVersion} in ${result.durationMs} ms.`);
    } else {
      appendLog("error", `${mode === "build" ? "Build" : "Check"} failed with ${result.diagnostics.length} diagnostic(s).`);
    }
    return completed;
    }catch(error){if(alive.current){setBuilds(currentProject.current?.buildHistory||[]);setNotice('Local task did not commit a result. Source buffers are retained; review the error before retrying.');}throw error;}finally{if(alive.current)setBusyTask(null);}
  }, [activeFile, appendLog, project]);

  const runTests = useCallback(async () => {
    if (!project) throw new Error("Open a project first.");
    if (!project.trusted) throw new Error("Trust the imported workspace before running tasks.");
    const submittedSnapshot=taskSnapshot(project);
    setBusyTask("test");
    try{
    appendLog("command", "forge test --all");
    const startedAt = performance.now();
    const results: ForgeTestResult[] = [];
    const definitions = project.files.filter((file) => file.path.endsWith(".test.json"));
    for (const definition of definitions) {
      let parsed: AbiTestFile;
      try {
        parsed = JSON.parse(definition.content) as AbiTestFile;
      } catch {
        results.push({
          id: id("test"),
          name: "Parse test definition",
          file: definition.path,
          status: "failed",
          durationMs: 1,
          message: "Test definition is not valid JSON.",
        });
        continue;
      }
      if (
        parsed.version !== 1 ||
        typeof parsed.contract !== "string" ||
        !Array.isArray(parsed.tests) ||
        parsed.tests.some(
          (test) =>
            !test ||
            typeof test.name !== "string" ||
            !["abi-method", "state-field", "manifest-chain", "bytecode-nonempty"].includes(
              test.assertion,
            ),
        )
      ) {
        results.push({
          id: id("test"),
          name: "Validate test definition",
          file: definition.path,
          status: "failed",
          durationMs: 1,
          message: "Test definition does not match Forge artifact-test schema version 1.",
        });
        continue;
      }
      const source = project.files.find((file) => file.path === parsed.contract);
      if (!source) {
        results.push({
          id: id("test"),
          name: definition.path,
          file: definition.path,
          status: "failed",
          durationMs: 1,
          message: `Contract source ${parsed.contract} was not found.`,
        });
        continue;
      }
      const compiled = await compileSynqSource(source.content, source.path);
      if(!alive.current||!currentProject.current||taskSnapshot(currentProject.current)!==submittedSnapshot)throw Error("Workspace changed during artifact checks; results not applied.");
      setDiagnostics(compiled.diagnostics);
      if (!compiled.ok || !compiled.artifacts) {
        results.push({
          id: id("test"),
          name: `Compile ${source.path}`,
          file: source.path,
          status: "failed",
          durationMs: compiled.durationMs,
          message: compiled.diagnostics[0]?.message || "Compiler failed.",
        });
        continue;
      }
      for (const test of parsed.tests) {
        const testStarted = performance.now();
        const passed = evaluateTest(test, compiled.artifacts);
        results.push({
          id: id("test"),
          name: test.name,
          file: definition.path,
          status: passed ? "passed" : "failed",
          durationMs: Math.max(1, Math.round(performance.now() - testStarted)),
          message: passed
            ? `${test.assertion} matched ${String(test.value)}.`
            : `${test.assertion} did not match ${String(test.value)}.`,
        });
      }
    }
    if (!definitions.length) {
      results.push({
        id: id("test"),
        name: "Discover test definitions",
        file: "tests/",
        status: "failed",
        durationMs: 1,
        message: "No *.test.json ABI test definitions were found.",
      });
    }
    const run: ForgeTestRun = {
      id: id("testrun"),
      startedAt: new Date(Date.now() - (performance.now() - startedAt)).toISOString(),
      completedAt: now(),
      status: results.every((result) => result.status === "passed") ? "passed" : "failed",
      passed: results.filter((result) => result.status === "passed").length,
      failed: results.filter((result) => result.status === "failed").length,
      results,
    };
    if(!alive.current||!currentProject.current||taskSnapshot(currentProject.current)!==submittedSnapshot)throw Error('Workspace changed during artifact checks; results not applied.');
    const next:ForgeProject={...currentProject.current,testHistory:[run,...(currentProject.current.testHistory||[])].slice(0,20),updatedAt:now()};
    await saveProject(next);
    if(!alive.current||currentProject.current?.id!==project.id)throw Error('Workspace changed before artifact-check publication.');
    setProject(next);setTestRuns(next.testHistory||[]);
    appendLog(
      run.status === "passed" ? "success" : "error",
      `${run.passed} passed, ${run.failed} failed in ${Math.max(1, Math.round(performance.now() - startedAt))} ms.`,
    );
    return run;
    }catch(error){if(alive.current){setBuilds(currentProject.current?.buildHistory||[]);setNotice('Local task did not commit a result. Source buffers are retained; review the error before retrying.');}throw error;}finally{if(alive.current)setBusyTask(null);}
  }, [appendLog, project]);

  const search = useCallback((query: string) => {
    if (!project || !query.trim()) return [];
    const needle = query.toLowerCase();
    return project.files.flatMap((file) =>
      file.content.split("\n").flatMap((line, index) =>
        line.toLowerCase().includes(needle)
          ? [{ file: file.path, line: index + 1, preview: line.trim() || " " }]
          : [],
      ),
    ).slice(0, 250);
  }, [project]);

  return {
    project,
    activeFile,
    recentProjects,
    hydrated,
    compilerStatus,
    diagnostics,
    builds,
    testRuns,
    taskLog,
    busyTask,
    notice,
    setNotice,
    changes,
    dirtyCount,
    openTemplate,
    newProject,
    openRecent,
    importFiles,
    importArchive,
    exportProject,
    trustProject,
    openFile,
    closeTab,
    updateActiveFile,
    saveActiveFile,
    createFile,
    renameFile,
    deleteFile,
    commitBaseline,
    build,
    runTests,
    search,
    appendLog,
  };
}
