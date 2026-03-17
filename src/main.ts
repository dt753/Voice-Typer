import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  systemPreferences,
  session,
  shell,
  clipboard,
  screen,
} from 'electron';
import * as path from 'path';
import * as zlib from 'zlib';
import { startHotkeyListener, stopHotkeyListener, updateHotkey, suspendHotkey, resumeHotkey } from './hotkey';
import { transcribe } from './transcriber';
import { injectText } from './injector';
import { initDb, loadSettings, saveSettings, addHistoryEntry, getHistory, deleteHistoryEntry, clearHistory, Replacement } from './db';

function applyReplacements(text: string, replacements: Replacement[]): string {
  let result = text;
  for (const r of replacements) {
    if (!r.from) continue;
    const escaped = r.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    result = result.replace(regex, (match) => {
      if (!r.preserveCase) return r.to;
      if (match[0] === match[0].toUpperCase() && match[0] !== match[0].toLowerCase()) {
        return r.to.charAt(0).toUpperCase() + r.to.slice(1);
      }
      return r.to;
    });
  }
  return result;
}

// Один экземпляр — если уже запущен, просто выходим
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// Прячем из Dock на Mac (трей-приложение)
if (process.platform === 'darwin') {
  app.dock?.hide();
}

let tray: Tray | null = null;
let recorderWin: BrowserWindow | null = null;
let settingsWin: BrowserWindow | null = null;
let overlayWin: BrowserWindow | null = null;
let isRecording = false;


// ── Иконки трея (PNG, работает на Windows и Mac) ─────────────────────────────

function makePNG(r: number, g: number, b: number): Buffer {
  const size = 16;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const dx = x - 7.5, dy = y - 7.5;
      const inside = dx * dx + dy * dy < 7 * 7;
      const i = row + 1 + x * 3;
      raw[i]     = inside ? r : 0;
      raw[i + 1] = inside ? g : 0;
      raw[i + 2] = inside ? b : 0;
    }
  }
  const idat = zlib.deflateSync(raw);

  function chunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t = Buffer.from(type, 'ascii');
    const crc32 = (() => {
      let c = 0xFFFFFFFF;
      const buf = Buffer.concat([t, data]);
      for (const b of buf) {
        c ^= b;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      const out = Buffer.alloc(4); out.writeUInt32BE((c ^ 0xFFFFFFFF) >>> 0); return out;
    })();
    return Buffer.concat([len, t, data, crc32]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeTrayIcon(r: number, g: number, b: number): Electron.NativeImage {
  return nativeImage.createFromBuffer(makePNG(r, g, b));
}

let ICON: { idle: Electron.NativeImage; recording: Electron.NativeImage; processing: Electron.NativeImage };

function playSound(file: string): void {
  const s = loadSettings();
  const vol = (s.soundVolume ?? 70) / 100;
  const soundPath = path.join(__dirname, '../assets/sounds', file).replace(/\\/g, '/');
  recorderWin?.webContents.executeJavaScript(
    `(function(){ const a = new Audio(${JSON.stringify('file:///' + soundPath)}); a.volume = ${vol}; a.play().catch(()=>{}); })()`
  );
}

function setTrayState(state: 'idle' | 'recording' | 'processing'): void {
  const labels = {
    idle:       'Crystal Voice — ожидание (2× Right Shift)',
    recording:  'Crystal Voice — 🔴 запись…',
    processing: 'Crystal Voice — ⏳ транскрипция…',
  };
  tray?.setImage(ICON[state]);
  tray?.setToolTip(labels[state]);
}

// ── Трей ─────────────────────────────────────────────────────────────────────

function buildTray(): void {
  tray = new Tray(ICON.idle);
  tray.setToolTip('Crystal Voice — ожидание (2× Right Shift)');

  const menu = Menu.buildFromTemplate([
    { label: 'Настройки…', click: openSettings },
    { type: 'separator' },
    { label: 'Выход', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);

  if (process.platform !== 'darwin') {
    tray.on('click', openSettings);
  }
}

// ── Оверлей записи ────────────────────────────────────────────────────────────

function setOverlayBounds(mode: 'idle' | 'active'): void {
  if (!overlayWin) return;
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const w = mode === 'idle' ? 100 : 380;
  const h = mode === 'idle' ? 50 : 68;
  overlayWin.setBounds({ x: Math.round(width / 2 - w / 2), y: height - h - 12, width: w, height: h });
}

function createOverlayWindow(): void {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  overlayWin = new BrowserWindow({
    width: 100,
    height: 50,
    x: Math.round(width / 2 - 50),
    y: height - 62,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  overlayWin.loadFile(path.join(__dirname, 'renderer/overlay.html'));
  overlayWin.showInactive();
}

function showOverlay(state: 'recording' | 'processing'): void {
  if (!overlayWin) return;
  setOverlayBounds('active');
  overlayWin.webContents.send('overlay:state', state);
}

function hideOverlay(): void {
  if (!overlayWin) return;
  setOverlayBounds('idle');
  overlayWin.webContents.send('overlay:state', 'idle');
}

// ── Скрытое окно записи ───────────────────────────────────────────────────────

function createRecorderWindow(): void {
  recorderWin = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  recorderWin.loadFile(path.join(__dirname, 'renderer/recorder.html'));
}

// ── Окно настроек ─────────────────────────────────────────────────────────────

function openSettings(): void {
  if (settingsWin) {
    settingsWin.focus();
    return;
  }

  settingsWin = new BrowserWindow({
    width: 720,
    height: 780,
    title: 'Crystal Voice — Настройки',
    icon: APP_ICON,
    resizable: true,
    minimizable: true,
    maximizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });

  settingsWin.loadFile(path.join(__dirname, 'renderer/settings.html'));
  settingsWin.setMenuBarVisibility(false);
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
}

// ── IPC обработчики ───────────────────────────────────────────────────────────

ipcMain.handle('sound:preview', (_event, vol: number) => {
  const soundPath = path.join(__dirname, '../assets/sounds/mixkit-magic-notification-ring-2344.wav').replace(/\\/g, '/');
  recorderWin?.webContents.executeJavaScript(
    `(function(){ const a = new Audio(${JSON.stringify('file:///' + soundPath)}); a.volume = ${vol}; a.play().catch(()=>{}); })()`
  );
});
ipcMain.handle('hotkey:suspend', () => suspendHotkey());
ipcMain.handle('hotkey:resume',  () => resumeHotkey());
ipcMain.handle('shell:openMicSettings', () => {
  if (process.platform === 'darwin') {
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');
  } else {
    shell.openExternal('ms-settings:privacy-microphone');
  }
});

ipcMain.handle('settings:get', () => loadSettings());

const SERVER_URL = 'https://voice-typer-production.up.railway.app';

ipcMain.handle('auth:login', async (_event, { email, password }: { email: string; password: string }) => {
  const res = await fetch(`https://kmlmocplptxuqqfqoizd.supabase.co/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': 'sb_publishable_H6mCa5aY7pv24R-6hebWqw_CSKOG36e' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json() as any;
  if (!res.ok) return { error: data.error_description || data.msg || 'Ошибка входа' };
  saveSettings({ authToken: data.access_token, userEmail: email });
  return { ok: true };
});

ipcMain.handle('auth:register', async (_event, { email, password }: { email: string; password: string }) => {
  const res = await fetch(`https://kmlmocplptxuqqfqoizd.supabase.co/auth/v1/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': 'sb_publishable_H6mCa5aY7pv24R-6hebWqw_CSKOG36e' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json() as any;
  if (!res.ok) return { error: data.error_description || data.msg || 'Ошибка регистрации' };
  if (data.access_token) saveSettings({ authToken: data.access_token, userEmail: email });
  return { ok: true, needConfirm: !data.access_token };
});

ipcMain.handle('auth:logout', () => {
  saveSettings({ authToken: '', userEmail: '' });
});

ipcMain.handle('auth:getSubscription', async () => {
  const settings = loadSettings();
  if (!settings.authToken) return null;
  try {
    const res = await fetch(`${SERVER_URL}/subscription`, {
      headers: { Authorization: `Bearer ${settings.authToken}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
});

ipcMain.handle('auth:applyReferral', async (_event, code: string) => {
  const settings = loadSettings();
  if (!settings.authToken) return { error: 'Не авторизован' };
  const res = await fetch(`${SERVER_URL}/referral/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.authToken}` },
    body: JSON.stringify({ code }),
  });
  return await res.json();
});
ipcMain.handle('history:get', () => getHistory());
ipcMain.handle('history:delete', (_event, id: number) => deleteHistoryEntry(id));
ipcMain.handle('history:clear', () => clearHistory());
ipcMain.handle('clipboard:write', (_event, text: string) => clipboard.writeText(text));

ipcMain.on('overlay:mic-click', () => {
  if (!isRecording) {
    isRecording = true;
    playSound('mixkit-magic-notification-ring-2344.wav');
    setTrayState('recording');
    showOverlay('recording');
    recorderWin?.webContents.send('recorder:start');
  } else {
    isRecording = false;
    playSound('mixkit-magic-notification-ring-2344.wav');
    recorderWin?.webContents.send('recorder:stop');
  }
});

ipcMain.handle('settings:set', (_event, data) => {
  const current = loadSettings();
  saveSettings(data);

  // Обновляем хоткей без перезапуска
  if (data.hotkey && data.hotkey !== current.hotkey) {
    updateHotkey(data.hotkey);
  }

  // Перезапускаем стрим микрофона если изменился девайс
  if (data.micDeviceId !== undefined && data.micDeviceId !== current.micDeviceId) {
    recorderWin?.webContents.send('recorder:restart');
  }
});

ipcMain.on('audio:data', async (_event, audioBuffer: Buffer) => {
  const settings = loadSettings();
  const time = new Date().toLocaleTimeString('ru-RU');
  const sizeBytes = audioBuffer.length;

  if (!settings.authToken) {
    setTrayState('idle');
    openSettings();
    return;
  }

  setTrayState('processing');
  showOverlay('processing');
  try {
    const raw = await transcribe(audioBuffer, settings.authToken, settings.language, settings.customInstructions, settings.dictionary);
    const text = applyReplacements(raw, settings.replacements);
    console.log(`[STT] "${text}"`);
    const entry = { time, sizeBytes, status: (text ? 'ok' : 'skipped') as 'ok' | 'skipped', text: text || '(пусто)' };
    addHistoryEntry(entry);
    settingsWin?.webContents.send('history:entry', entry);
    if (text) injectText(text);
  } catch (err: any) {
    console.error('[ERR] Транскрипция:', err);
    const entry = { time, sizeBytes, status: 'error' as 'error', error: err?.message || String(err) };
    addHistoryEntry(entry);
    settingsWin?.webContents.send('history:entry', entry);
  } finally {
    setTrayState('idle');
    hideOverlay();
  }
});

// ── Запуск приложения ─────────────────────────────────────────────────────────

const APP_ICON = path.join(__dirname, '../assets/icon.png');

app.whenReady().then(async () => {
  // 1. База данных — первым делом
  initDb();

  // 2. Разрешаем медиа-доступ для всех сессий (до создания окон)
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media');
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return permission === 'media';
  });

  // 3. На macOS запрашиваем разрешение на микрофон до открытия окон
  if (process.platform === 'darwin') {
    const micGranted = await systemPreferences.askForMediaAccess('microphone');
    if (!micGranted) {
      console.warn('[WARN] Доступ к микрофону отклонён. Откройте Системные настройки → Конфиденциальность → Микрофон.');
    }
  }

  // 4. Иконки
  const crystalIcon = nativeImage.createFromPath(APP_ICON).resize({ width: 32, height: 32 });
  ICON = {
    idle:       crystalIcon,
    recording:  makeTrayIcon(231, 76, 60),
    processing: makeTrayIcon(243, 156, 18),
  };

  // 5. Трей → скрытое окно записи → окно настроек
  buildTray();
  createOverlayWindow();
  createRecorderWindow();
  openSettings();

  // 6. На macOS запрашиваем разрешение Accessibility для вставки текста
  if (process.platform === 'darwin') {
    const trusted = systemPreferences.isTrustedAccessibilityClient(true);
    if (!trusted) {
      console.warn('[WARN] Нужно разрешение Accessibility → Системные настройки → Конфиденциальность → Универсальный доступ.');
    }
  }

  // 7. Запускаем слушатель хоткея
  const settings = loadSettings();
  startHotkeyListener(() => {
    if (!isRecording) {
      isRecording = true;
      playSound('mixkit-magic-notification-ring-2344.wav');
      setTrayState('recording');
      showOverlay('recording');
      recorderWin?.webContents.send('recorder:start');
    } else {
      isRecording = false;
      playSound('mixkit-magic-notification-ring-2344.wav');
      recorderWin?.webContents.send('recorder:stop');
    }
  }, settings.hotkey);
});

app.on('will-quit', () => {
  stopHotkeyListener();
});

app.on('window-all-closed', () => { /* трей-приложение — не закрываемся */ });
