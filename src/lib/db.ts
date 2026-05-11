import Dexie, { type Table } from 'dexie';
import type { TranscriptCue } from './messages';

export interface Recording {
  id: string;
  name: string;
  blob: Blob;
  mimeType: string;
  durationMs: number;
  width: number;
  height: number;
  createdAt: number;
  transcript: TranscriptCue[];
  trimmedFrom?: string;
}

class KaboomDB extends Dexie {
  recordings!: Table<Recording, string>;

  constructor() {
    super('kaboom');
    this.version(1).stores({
      recordings: 'id, createdAt, name',
    });
  }
}

export const db = new KaboomDB();

export function newId(): string {
  return crypto.randomUUID().slice(0, 8);
}

export async function saveRecording(rec: Omit<Recording, 'id' | 'createdAt' | 'name'> & { name?: string }) {
  const id = newId();
  const createdAt = Date.now();
  const record: Recording = {
    id,
    createdAt,
    name: rec.name ?? defaultName(createdAt),
    ...rec,
  };
  await db.recordings.put(record);
  return record;
}

export function defaultName(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `Recording ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`;
}

export async function getRecording(id: string): Promise<Recording | undefined> {
  return db.recordings.get(id);
}

export async function listRecordings(): Promise<Recording[]> {
  return db.recordings.orderBy('createdAt').reverse().toArray();
}

export async function deleteRecording(id: string): Promise<void> {
  await db.recordings.delete(id);
}

export async function updateRecording(id: string, patch: Partial<Recording>): Promise<void> {
  await db.recordings.update(id, patch);
}

export async function replaceRecordingBlob(id: string, blob: Blob, durationMs: number): Promise<void> {
  await db.recordings.update(id, { blob, durationMs });
}
