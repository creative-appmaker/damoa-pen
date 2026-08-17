/**
 * IndexedDB storage for damoa-pen.
 * No size limits (unlike localStorage) — handles large base64 images.
 */
import { PenNote, Folder } from '../types';

const DB_NAME    = 'damoa-pen';
const DB_VERSION = 2;           // bumped: added 'folders' store
const STORE      = 'notes';
const FOLDER_STORE = 'folders';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
        store.createIndex('isPinned', 'isPinned');
        store.createIndex('folderId', 'folderId');
      } else {
        // v1→v2: folderId 인덱스 추가
        const tx = (e.target as IDBOpenDBRequest).transaction!;
        const store = tx.objectStore(STORE);
        if (!store.indexNames.contains('folderId')) {
          store.createIndex('folderId', 'folderId');
        }
      }
      if (!db.objectStoreNames.contains(FOLDER_STORE)) {
        const fs = db.createObjectStore(FOLDER_STORE, { keyPath: 'id' });
        fs.createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror  = () => reject(req.error);
  });
}

// ── Notes ──────────────────────────────────────────────────────────────────

export async function getAllNotes(): Promise<PenNote[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const notes: PenNote[] = req.result;
      notes.sort((a, b) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        return b.updatedAt - a.updatedAt;
      });
      resolve(notes);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveNote(note: PenNote): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(note);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

export async function deleteNote(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

export async function exportAllNotes(): Promise<string> {
  const notes = await getAllNotes();
  return JSON.stringify(notes, null, 2);
}

export async function importNotes(json: string): Promise<number> {
  const notes: PenNote[] = JSON.parse(json);
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    notes.forEach(n => store.put(n));
    tx.oncomplete = () => resolve(notes.length);
    tx.onerror    = () => reject(tx.error);
  });
}

// ── Folders ────────────────────────────────────────────────────────────────

export async function getFolders(): Promise<Folder[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(FOLDER_STORE, 'readonly');
    const req = tx.objectStore(FOLDER_STORE).getAll();
    req.onsuccess = () => {
      const folders: Folder[] = req.result;
      folders.sort((a, b) => a.createdAt - b.createdAt);
      resolve(folders);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveFolder(folder: Folder): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FOLDER_STORE, 'readwrite');
    tx.objectStore(FOLDER_STORE).put(folder);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

export async function deleteFolder(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FOLDER_STORE, 'readwrite');
    tx.objectStore(FOLDER_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}
