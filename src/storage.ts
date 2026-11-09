import type { PatternDoc } from './core/doc';
import type { Crop } from './core/image';
import { DEFAULT_PARAMS, type Params } from './core/pattern';

export type Project = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  image: Blob;
  crop: Crop;
  params: Params;
  doc: PatternDoc | null;
  cropped: Blob | null;
  edited: boolean;
};

/** Before there were several projects, the one pattern lived under this key. */
const LEGACY_KEY = 'current';
const DB = 'jamie-pindou';
const STORE = 'projects';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        tx.onerror = tx.onabort = () => {
          db.close();
          reject(tx.error);
        };
      }),
  );
}

export const newProjectId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Saving is best effort: private browsing may refuse it, and the session still works. */
export const saveProject = (p: Project) =>
  run('readwrite', (s) => s.put(p, p.id)).catch((e) => console.warn('could not save the project', e));

export const deleteProject = (id: string) =>
  run('readwrite', (s) => s.delete(id)).catch((e) => console.warn('could not delete the project', e));

/** Saved settings may predate newer options, which then take their defaults. */
const withDefaults = (p: Project): Project => ({ ...p, params: { ...DEFAULT_PARAMS, ...p.params } });

export async function listProjects(): Promise<Project[]> {
  try {
    const legacy = await run('readonly', (s) => s.get(LEGACY_KEY) as IDBRequest<Omit<Project, 'id' | 'name' | 'createdAt' | 'updatedAt'> | undefined>);
    if (legacy) {
      const now = Date.now();
      await saveProject({ ...legacy, id: newProjectId(), name: '上次的图纸', createdAt: now, updatedAt: now });
      await run('readwrite', (s) => s.delete(LEGACY_KEY));
    }
    const all = await run('readonly', (s) => s.getAll() as IDBRequest<Project[]>);
    return all.map(withDefaults).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Remembering a setting is a convenience; losing it changes nothing else.
  }
}

export const loadPrefs = () => readJson<Params>('pindou.prefs', DEFAULT_PARAMS);
export const savePrefs = (p: Params) => writeJson('pindou.prefs', p);

export const loadMyColors = (brandId: string): string[] =>
  readJson<{ codes: string[] }>(`pindou.mine.${brandId}`, { codes: [] }).codes;
export const saveMyColors = (brandId: string, codes: string[]) => writeJson(`pindou.mine.${brandId}`, { codes });
