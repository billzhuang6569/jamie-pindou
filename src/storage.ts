import type { PatternDoc } from './core/doc';
import type { Crop } from './core/image';
import type { Spec } from './core/palette';

export type RatioMode = 'board' | 'image';

export type Params = {
  ratioMode: RatioMode;
  w: number;
  h: number;
  brandId: string;
  spec: Spec;
  mergeLevel: number;
  maxColors: number;
};

export const DEFAULT_PARAMS: Params = {
  ratioMode: 'board',
  w: 52,
  h: 52,
  brandId: 'mard',
  spec: 'base',
  mergeLevel: 2,
  maxColors: 0,
};

export type SavedProject = {
  image: Blob;
  crop: Crop;
  params: Params;
  doc: PatternDoc | null;
  cropped: Blob | null;
  edited: boolean;
};

const DB = 'jamie-pindou';
const STORE = 'projects';
const KEY = 'current';

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

/** Saving is best effort: private browsing may refuse it, and the session still works. */
export const saveProject = (p: SavedProject) =>
  run('readwrite', (s) => s.put(p, KEY)).catch((e) => console.warn('could not save the project', e));

export const loadProject = (): Promise<SavedProject | null> =>
  run('readonly', (s) => s.get(KEY) as IDBRequest<SavedProject | undefined>)
    .then((v) => v ?? null)
    .catch(() => null);

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
