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
  userId: string;
  displayName: string;
  language: string;
  micDeviceId: string;
  vadThreshold: number;
  hotkey: string;
  hotkeyMode: 'double-tap' | 'push-to-talk';
  pttKey: string; // e.code формат: 'ShiftRight', 'CapsLock', 'KeyA', 'F9' и т.д.
  replacements: Replacement[];
  dictionary: string[];
  customInstructions: string;
  soundVolume: number;
  overlayEnabled: boolean;
  refreshToken: string;
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
  userId: '',
  displayName: '',
  language: 'ru',
  micDeviceId: '',
  vadThreshold: 0.008,
  hotkey: 'F9',
  hotkeyMode: 'double-tap',
  pttKey: '',
  replacements: [],
  dictionary: [],
  customInstructions: '',
  soundVolume: 70,
  overlayEnabled: true,
  refreshToken: '',
};

let db: Database.Database;
let _settingsCache: AppSettings | null = null;

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
  if (_settingsCache) return _settingsCache;
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const obj: any = { ...DEFAULTS };
  for (const row of rows) {
    try { obj[row.key] = JSON.parse(row.value); } catch { obj[row.key] = row.value; }
  }
  _settingsCache = obj as AppSettings;
  return _settingsCache;
}

export function saveSettings(data: Partial<AppSettings>): void {
  const insert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const tx = db.transaction((d: Partial<AppSettings>) => {
    for (const [key, value] of Object.entries(d)) {
      insert.run(key, JSON.stringify(value));
    }
  });
  tx(data);
  _settingsCache = null;
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

export interface Stats {
  todayWords:          number;
  totalWords:          number;
  totalTranscriptions: number;
  timeSavedMinutes:    number;
}

export function getStats(): Stats {
  const countWords = (text: string) =>
    text?.trim() ? text.trim().split(/\s+/).length : 0;

  const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);

  const all = db.prepare(
    `SELECT text, createdAt FROM history WHERE status = 'ok'`
  ).all() as { text: string; createdAt: number }[];

  let totalWords = 0;
  let todayWords = 0;

  for (const row of all) {
    const w = countWords(row.text);
    totalWords += w;
    if (row.createdAt >= todayStart) todayWords += w;
  }

  return {
    todayWords,
    totalWords,
    totalTranscriptions: all.length,
    timeSavedMinutes: Math.round(totalWords / 40), // ~40 слов/мин средняя скорость печати
  };
}
