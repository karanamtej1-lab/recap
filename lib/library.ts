// Saved recaps live in this browser's IndexedDB - transcript, recap, flashcards, and the
// original media file itself, so reopening never means re-transcribing. Nothing is uploaded.
import type { Card } from "./cards";
import type { Recap, Segment, Word } from "./types";

export type SavedRecap = {
  id: string;
  title: string;
  createdAt: number;
  duration: number;
  words: Word[];
  segments: Segment[];
  recap: Recap;
  cards: Card[];
  media: Blob | null; // null if it was too big to store, or a pasted transcript
  mediaKind: "video" | "audio" | null;
  mediaName: string | null;
};

export type LibraryItem = Pick<SavedRecap, "id" | "title" | "createdAt" | "duration" | "mediaKind"> & { due: number; hasMedia: boolean };

const DB = "recap";
const STORE = "recaps";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

export async function saveRecap(entry: SavedRecap): Promise<{ savedMedia: boolean }> {
  try {
    await tx("readwrite", (s) => s.put(entry));
    return { savedMedia: Boolean(entry.media) };
  } catch {
    // Usually a storage quota error from a big video: keep everything except the file.
    await tx("readwrite", (s) => s.put({ ...entry, media: null }));
    return { savedMedia: false };
  }
}

export async function getRecap(id: string): Promise<SavedRecap | undefined> {
  return tx("readonly", (s) => s.get(id) as IDBRequest<SavedRecap | undefined>);
}

export async function listRecaps(): Promise<LibraryItem[]> {
  const all = await tx("readonly", (s) => s.getAll() as IDBRequest<SavedRecap[]>);
  const now = Date.now();
  return all
    .map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.createdAt,
      duration: r.duration,
      mediaKind: r.mediaKind,
      hasMedia: Boolean(r.media),
      due: r.cards.filter((c) => c.due <= now).length,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function updateCards(id: string, cards: Card[]): Promise<void> {
  const r = await getRecap(id);
  if (r) await tx("readwrite", (s) => s.put({ ...r, cards }));
}

export async function deleteRecap(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
