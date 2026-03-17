import { contextBridge, ipcRenderer, shell } from 'electron';

contextBridge.exposeInMainWorld('api', {
  // ── Recorder window ──────────────────────────────────────────────────────
  onStart:   (cb: () => void) => ipcRenderer.on('recorder:start',   () => cb()),
  onStop:    (cb: () => void) => ipcRenderer.on('recorder:stop',    () => cb()),
  onRestart: (cb: () => void) => ipcRenderer.on('recorder:restart', () => cb()),

  sendAudio: (arrayBuffer: ArrayBuffer) =>
    ipcRenderer.send('audio:data', Buffer.from(arrayBuffer)),

  // ── Settings window ──────────────────────────────────────────────────────
  getSettings: () => ipcRenderer.invoke('settings:get'),

  saveSettings: (s: {
    apiKey: string;
    language: string;
    micDeviceId: string;
    vadThreshold: number;
    hotkey: string;
    replacements: { from: string; to: string; preserveCase: boolean }[];
    dictionary: string[];
    customInstructions: string;
    soundVolume: number;
  }): Promise<void> => ipcRenderer.invoke('settings:set', s),

  openExternal: (url: string) => shell.openExternal(url),

  suspendHotkey: () => ipcRenderer.invoke('hotkey:suspend'),
  resumeHotkey:  () => ipcRenderer.invoke('hotkey:resume'),
  previewSound:  (vol: number) => ipcRenderer.invoke('sound:preview', vol),
  openMicSettings: () => ipcRenderer.invoke('shell:openMicSettings'),

  platform: process.platform,

  // ── History ──────────────────────────────────────────────────────────────
  getHistory: () => ipcRenderer.invoke('history:get'),
  deleteHistory: (id: number) => ipcRenderer.invoke('history:delete', id),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  onHistoryEntry: (cb: (entry: any) => void) =>
    ipcRenderer.on('history:entry', (_e, entry) => cb(entry)),
});
