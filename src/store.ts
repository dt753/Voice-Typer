import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface Replacement {
  from: string;
  to: string;
  preserveCase: boolean;
}

export interface AppSettings {
  apiKey: string;
  language: string;
  micDeviceId: string;
  vadThreshold: number;
  hotkey: string;
  replacements: Replacement[];
  dictionary: string[];
  customInstructions: string;
}

const DEFAULTS: AppSettings = {
  apiKey: '',
  language: 'ru',
  micDeviceId: '',
  vadThreshold: 0.008,
  hotkey: 'F9',
  replacements: [],
  dictionary: [],
  customInstructions: '',
};

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function loadSettings(): AppSettings {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf-8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(data: Partial<AppSettings>): void {
  const current = loadSettings();
  const updated = { ...current, ...data };
  fs.writeFileSync(settingsPath(), JSON.stringify(updated, null, 2), 'utf-8');
}
