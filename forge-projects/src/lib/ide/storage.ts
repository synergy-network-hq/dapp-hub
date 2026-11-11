import type { ForgeProject } from "./types";

const DB_NAME = "synergy-forge-v3";
const DB_VERSION = 1;
const PROJECT_STORE = "projects";


function validateProject(value: unknown): ForgeProject {
  const p=value as ForgeProject;
  const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length<=max;
  const instant=(v:unknown)=>text(v,64)&&Number.isFinite(Date.parse(v));
  const path=(v:unknown)=>text(v,240)&&!!v&&!v.startsWith('/')&&!v.includes('\\')&&!v.split('/').some(part=>!part||part==='.'||part==='..');
  if(!p||typeof p!=='object'||p.schemaVersion!==2||!text(p.id,160)||!p.id||!text(p.name,100)||!instant(p.createdAt)||!instant(p.updatedAt)||typeof p.trusted!=='boolean'||!['local','template','folder','archive','git'].includes(p.source)||!Array.isArray(p.files)||p.files.length>2000||!Array.isArray(p.openTabs)||p.openTabs.some(v=>!path(v))||!(p.activeFile===null||path(p.activeFile))||!p.baseline||typeof p.baseline!=='object'||Array.isArray(p.baseline)||Object.entries(p.baseline).some(([k,v])=>!path(k)||!text(v,1000000))||p.files.some(f=>!f||!text(f.id,160)||!path(f.path)||!text(f.content,1000000)||!text(f.savedContent,1000000)||!['synq','json','toml','markdown','text'].includes(f.language)||!instant(f.modifiedAt))||new Set(p.files.map(f=>f.path)).size!==p.files.length||JSON.stringify(p).length>80000000)throw Error('Saved Forge project is unsupported; original storage retained.');
  return p;
}

const hasIndexedDb = () => typeof indexedDB !== "undefined";
const projectKey = (id: string) => `forge-v3-project:${id}`;

function saveFallback(project: ForgeProject) {
  try {
    const previous=localStorage.getItem(projectKey(project.id));if(previous!==null){if(previous.length>80000000)throw Error('Oversized saved project');validateProject(JSON.parse(previous));}
    localStorage.setItem(projectKey(project.id), JSON.stringify(project));
    localStorage.setItem("forge-v3-last-project", project.id);
    return true;
  } catch {
    return false;
  }
}

function loadFallback(id: string): ForgeProject | null {
 const stored=localStorage.getItem(projectKey(id));if(stored===null)return null;
 if(stored.length>80000000)throw Error('Saved project exceeds supported size; original retained.');
 try{return validateProject(JSON.parse(stored));}catch{throw Error('Saved project is unreadable or unsupported; original retained.');}
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROJECT_STORE)) {
        database.createObjectStore(PROJECT_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function requestFromStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(PROJECT_STORE, mode);
      const request = operation(transaction.objectStore(PROJECT_STORE));
      let value: T;
      request.onsuccess = () => { value = request.result; };
      transaction.oncomplete = () => resolve(value);
      transaction.onerror = () => reject(transaction.error || request.error);
      transaction.onabort = () => reject(transaction.error || new Error("Workspace transaction aborted"));
    });
  } finally {
    database.close();
  }
}

export async function saveProject(project: ForgeProject) {
  validateProject(project);
  let saved = false;
  if (hasIndexedDb()) {
    try { const previous=await requestFromStore<ForgeProject|undefined>("readonly",store=>store.get(project.id));if(previous)validateProject(previous);await requestFromStore("readwrite", (store) => store.put(project)); saved = true; }
    catch { /* Try the synchronous recovery copy. */ }
  }
  const recoverySaved = saveFallback(project);
  if (!saved && !recoverySaved) throw new Error("Local project storage is unavailable. Keep this window open and copy your source before closing.");
}

export async function loadProject(id: string): Promise<ForgeProject | null> {
  if (hasIndexedDb()) {
    try {
      const project = await requestFromStore<ForgeProject | undefined>(
        "readonly",
        (store) => store.get(id),
      );
      if (project) return validateProject(project);
    } catch {
      return loadFallback(id);
    }
  }
  return loadFallback(id);
}

export async function listProjects(): Promise<ForgeProject[]> {
  let projects: ForgeProject[] = [];
  if (hasIndexedDb()) {
    try {
      projects = await requestFromStore<ForgeProject[]>(
        "readonly",
        (store) => store.getAll(),
      );
    } catch {
      projects = [];
    }
  }
  if (!projects.length) {
    try {
      projects = Object.keys(localStorage)
        .filter((key) => key.startsWith("forge-v3-project:"))
        .map((key) => loadFallback(key.slice("forge-v3-project:".length)))
        .filter((project): project is ForgeProject => Boolean(project));
    } catch {
      throw Error('Saved project list is unreadable; original records retained.');
    }
  }
  return projects.map(validateProject).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteProject(id: string) {
  if (hasIndexedDb()) {
    try {
      await requestFromStore("readwrite", (store) => store.delete(id));
    } catch {
      // Continue with the fallback store.
    }
  }
  try {
    localStorage.removeItem(projectKey(id));
  } catch {
    // Storage may be unavailable in constrained browser contexts.
  }
}
