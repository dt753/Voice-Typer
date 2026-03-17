import { globalShortcut } from 'electron';

const DOUBLE_TAP_MS = 450;
const KEY_RELEASE_GAP_MS = 500; // пауза >= 500мс = клавиша отпущена
let lastTapTime = 0;
let lastEventTime = 0;
let keyHeld = false; // уже сработало — ждём отпускания
let currentAccel = 'F9';
let onDoubleTapCb: (() => void) | null = null;

function doubleTapHandler() {
  const now = Date.now();
  const gap = now - lastEventTime;
  lastEventTime = now;

  // Если пауза большая — клавишу отпустили, сбрасываем флаг зажатия
  if (gap >= KEY_RELEASE_GAP_MS) {
    keyHeld = false;
  }

  // Пока клавиша держится после срабатывания — игнорируем
  if (keyHeld) return;

  const delta = now - lastTapTime;
  lastTapTime = now;

  if (delta < DOUBLE_TAP_MS) {
    lastTapTime = 0;
    keyHeld = true; // блокируем повторы до отпускания
    onDoubleTapCb?.();
  }
}

function register(accel: string): boolean {
  try {
    const ok = globalShortcut.register(accel, doubleTapHandler);
    if (!ok) console.warn(`[HOTKEY] Не удалось зарегистрировать "${accel}" (уже занято другим приложением?)`);
    return ok;
  } catch (e: any) {
    console.error(`[HOTKEY] Ошибка регистрации "${accel}":`, e.message);
    return false;
  }
}

// Если сохранённый хоткей в старом формате (event.code) — сбрасываем на F9
function sanitize(hotkey: string): string {
  // Голые модификаторы не работают в globalShortcut
  if (/^(Shift|Control|Alt|Meta)(Left|Right)?$/.test(hotkey)) return 'F9';
  // Старый формат event.code (KeyA, CapsLock и т.д.) — не работают в globalShortcut
  if (/^(Key[A-Z]|Digit\d|Caps|Print|Scroll)/.test(hotkey)) return 'F9';
  return hotkey;
}

export function startHotkeyListener(onDoubleTap: () => void, hotkey = 'F9'): void {
  onDoubleTapCb = onDoubleTap;
  currentAccel = sanitize(hotkey);
  register(currentAccel);
  console.log(`[HOTKEY] Запущен. Двойной тап "${currentAccel}" — триггер.`);
}

export function updateHotkey(hotkey: string): void {
  try { globalShortcut.unregister(currentAccel); } catch {}
  currentAccel = sanitize(hotkey);
  lastTapTime = 0;
  register(currentAccel);
  console.log(`[HOTKEY] Хоткей → "${currentAccel}"`);
}

export function suspendHotkey(): void {
  try { globalShortcut.unregister(currentAccel); } catch {}
}

export function resumeHotkey(): void {
  register(currentAccel);
}

export function stopHotkeyListener(): void {
  globalShortcut.unregisterAll();
}
