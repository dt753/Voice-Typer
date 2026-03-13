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
  }): Promise<void> => ipcRenderer.invoke('settings:set', s),

  openExternal: (url: string) => shell.openExternal(url),

  suspendHotkey: () => ipcRenderer.invoke('hotkey:suspend'),
  resumeHotkey:  () => ipcRenderer.invoke('hotkey:resume'),

  // ── History ──────────────────────────────────────────────────────────────
  getHistory: () => ipcRenderer.invoke('history:get'),
  onHistoryEntry: (cb: (entry: any) => void) =>
    ipcRenderer.on('history:entry', (_e, entry) => cb(entry)),
});
