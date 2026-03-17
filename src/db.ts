import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import Database from 'better-sqlite3';

export interface Replacement {
  from: string;
  to: string;
  preserveCase: boolean;
}

export interface AppSettings {
  authToken: string;
  userEmail: string;
  displayName: string;
  language: string;
  micDeviceId: string;
  vadThreshold: number;
  hotkey: string;
  replacements: Replacement[];
  dictionary: string[];
  customInstructions: string;
  soundVolume: number;
}

export interface HistoryEntry {
  id?: number;
  time: string;
  sizeBytes: number;
  status: 'ok' | 'error' | 'skipped';
  text?: string;
  error?: string;
}

const DEFAULTS: AppSettings = {
  authToken: '',
  userEmail: '',
  displayName: '',
  language: 'ru',
  micDeviceId: '',
  vadThreshold: 0.008,
  hotkey: 'F9',
  replacements: [],
  dictionary: [],
  customInstructions: '',
  soundVolume: 70,
};

let db: Database.Database;

export function initDb(): void {
  const dbPath = path.join(app.getPath('userData'), 'voicetyper.db');
  db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS history (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      time      TEXT    NOT NULL,
      sizeBytes INTEGER NOT NULL,
      status    TEXT    NOT NULL,
      text      TEXT,
      error     TEXT,
      createdAt INTEGER DEFAULT (strftime('%s', 'now'))
    );
  `);

  migrateFromJson();
}

function migrateFromJson(): void {
  const jsonPath = path.join(app.getPath('userData'), 'settings.json');
  if (!fs.existsSync(jsonPath)) return;
  try {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    const { cnt } = db.prepare('SELECT COUNT(*) as cnt FROM settings').get() as { cnt: number };
    if (cnt === 0) saveSettings(data);
    fs.renameSync(jsonPath, jsonPath + '.bak');
    console.log('[DB] Мигрировано из settings.json → SQLite');
  } catch (e) {
    console.warn('[DB] Ошибка миграции:', e);
  }
}

export function loadSettings(): AppSettings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const obj: any = { ...DEFAULTS };
  for (const row of rows) {
    try { obj[row.key] = JSON.parse(row.value); } catch { obj[row.key] = row.value; }
  }
  return obj as AppSettings;
}

export function saveSettings(data: Partial<AppSettings>): void {
  const insert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const tx = db.transaction((d: Partial<AppSettings>) => {
    for (const [key, value] of Object.entries(d)) {
      insert.run(key, JSON.stringify(value));
    }
  });
  tx(data);
}

export function addHistoryEntry(entry: HistoryEntry): void {
  db.prepare(`
    INSERT INTO history (time, sizeBytes, status, text, error)
    VALUES (?, ?, ?, ?, ?)
  `).run(entry.time, entry.sizeBytes, entry.status, entry.text ?? null, entry.error ?? null);

  // Храним только последние 500 записей
  db.prepare(`
    DELETE FROM history WHERE id NOT IN (
      SELECT id FROM history ORDER BY id DESC LIMIT 500
    )
  `).run();
}

export function getHistory(limit = 100): HistoryEntry[] {
  return db.prepare(`
    SELECT id, time, sizeBytes, status, text, error
    FROM history ORDER BY id DESC LIMIT ?
  `).all(limit) as HistoryEntry[];
}

export function deleteHistoryEntry(id: number): void {
  db.prepare('DELETE FROM history WHERE id = ?').run(id);
}

export function clearHistory(): void {
  db.prepare('DELETE FROM history').run();
}
