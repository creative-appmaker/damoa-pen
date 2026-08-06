/**
 * IndexedDB storage for damoa-pen.
 * No size limits (unlike localStorage) — handles large base64 images.
 */
import { PenNote } from '../types';

const DB_NAME = 'damoa-pen';
const DB_VERSION = 1;
const STORE = 'notes';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
        store.createIndex('isPinned', 'isPinned');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllNotes(): Promise<PenNote[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const notes: PenNote[] = req.result;
      // Pinned first, then by updatedAt desc
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
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteNote(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
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
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    notes.forEach(n => store.put(n));
    tx.oncomplete = () => resolve(notes.length);
    tx.onerror = () => reject(tx.error);
  });
}
