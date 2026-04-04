import { globalShortcut } from 'electron';
import { uIOhook, UiohookKey } from 'uiohook-napi';

const DOUBLE_TAP_MS = 450;
const KEY_RELEASE_GAP_MS = 500; // пауза >= 500мс = клавиша отпущена
let lastTapTime = 0;
let lastEventTime = 0;
let keyHeld = false; // уже сработало — ждём отпускания
let currentAccel = 'F9';
let onDoubleTapCb: (() => void) | null = null;

// ── Push-to-talk ─────────────────────────────────────────────────────────────

// Маппинг e.code (браузер/PTT) → uiohook keycode
const CODE_TO_UIOHOOK: Record<string, number> = {
  // Функциональные клавиши
  F1: UiohookKey.F1,   F2: UiohookKey.F2,   F3: UiohookKey.F3,
  F4: UiohookKey.F4,   F5: UiohookKey.F5,   F6: UiohookKey.F6,
  F7: UiohookKey.F7,   F8: UiohookKey.F8,   F9: UiohookKey.F9,
  F10: UiohookKey.F10, F11: UiohookKey.F11, F12: UiohookKey.F12,
  F13: UiohookKey.F13, F14: UiohookKey.F14, F15: UiohookKey.F15,
  F16: UiohookKey.F16, F17: UiohookKey.F17, F18: UiohookKey.F18,
  F19: UiohookKey.F19, F20: UiohookKey.F20, F21: UiohookKey.F21,
  F22: UiohookKey.F22, F23: UiohookKey.F23, F24: UiohookKey.F24,
  // Буквы (e.code формат: KeyA, KeyB...)
  KeyA: UiohookKey.A, KeyB: UiohookKey.B, KeyC: UiohookKey.C,
  KeyD: UiohookKey.D, KeyE: UiohookKey.E, KeyF: UiohookKey.F,
  KeyG: UiohookKey.G, KeyH: UiohookKey.H, KeyI: UiohookKey.I,
  KeyJ: UiohookKey.J, KeyK: UiohookKey.K, KeyL: UiohookKey.L,
  KeyM: UiohookKey.M, KeyN: UiohookKey.N, KeyO: UiohookKey.O,
  KeyP: UiohookKey.P, KeyQ: UiohookKey.Q, KeyR: UiohookKey.R,
  KeyS: UiohookKey.S, KeyT: UiohookKey.T, KeyU: UiohookKey.U,
  KeyV: UiohookKey.V, KeyW: UiohookKey.W, KeyX: UiohookKey.X,
  KeyY: UiohookKey.Y, KeyZ: UiohookKey.Z,
  // Цифры (e.code: Digit0..Digit9)
  Digit0: UiohookKey[0], Digit1: UiohookKey[1], Digit2: UiohookKey[2],
  Digit3: UiohookKey[3], Digit4: UiohookKey[4], Digit5: UiohookKey[5],
  Digit6: UiohookKey[6], Digit7: UiohookKey[7], Digit8: UiohookKey[8],
  Digit9: UiohookKey[9],
  // Стрелки
  ArrowLeft: UiohookKey.ArrowLeft, ArrowRight: UiohookKey.ArrowRight,
  ArrowUp:   UiohookKey.ArrowUp,   ArrowDown:  UiohookKey.ArrowDown,
  // Модификаторы — очень удобны для PTT
  ShiftLeft:    UiohookKey.Shift,      ShiftRight:   UiohookKey.ShiftRight,
  ControlLeft:  UiohookKey.Ctrl,       ControlRight: UiohookKey.CtrlRight,
  AltLeft:      UiohookKey.Alt,        AltRight:     UiohookKey.AltRight,
  MetaLeft:     UiohookKey.Meta,       MetaRight:    UiohookKey.MetaRight,
  // Спецклавиши
  CapsLock: UiohookKey.CapsLock, Tab:       UiohookKey.Tab,
  Escape:   UiohookKey.Escape,   Enter:     UiohookKey.Enter,
  Backspace: UiohookKey.Backspace, Space:   UiohookKey.Space,
  Insert:   UiohookKey.Insert,   Delete:    UiohookKey.Delete,
  Home:     UiohookKey.Home,     End:       UiohookKey.End,
  PageUp:   UiohookKey.PageUp,   PageDown:  UiohookKey.PageDown,
  PrintScreen: UiohookKey.PrintScreen, ScrollLock: UiohookKey.ScrollLock,
  NumLock:  UiohookKey.NumLock,
  // Алиасы формата Electron accelerator (фолбек когда pttKey не задан)
  A: UiohookKey.A, B: UiohookKey.B, C: UiohookKey.C, D: UiohookKey.D,
  E: UiohookKey.E, F: UiohookKey.F, G: UiohookKey.G, H: UiohookKey.H,
  I: UiohookKey.I, J: UiohookKey.J, K: UiohookKey.K, L: UiohookKey.L,
  M: UiohookKey.M, N: UiohookKey.N, O: UiohookKey.O, P: UiohookKey.P,
  Q: UiohookKey.Q, R: UiohookKey.R, S: UiohookKey.S, T: UiohookKey.T,
  U: UiohookKey.U, V: UiohookKey.V, W: UiohookKey.W, X: UiohookKey.X,
  Y: UiohookKey.Y, Z: UiohookKey.Z,
  '0': UiohookKey[0], '1': UiohookKey[1], '2': UiohookKey[2],
  '3': UiohookKey[3], '4': UiohookKey[4], '5': UiohookKey[5],
  '6': UiohookKey[6], '7': UiohookKey[7], '8': UiohookKey[8], '9': UiohookKey[9],
  Left: UiohookKey.ArrowLeft, Right: UiohookKey.ArrowRight,
  Up:   UiohookKey.ArrowUp,   Down:  UiohookKey.ArrowDown,
  // Numpad
  Numpad0: UiohookKey.Numpad0, Numpad1: UiohookKey.Numpad1,
  Numpad2: UiohookKey.Numpad2, Numpad3: UiohookKey.Numpad3,
  Numpad4: UiohookKey.Numpad4, Numpad5: UiohookKey.Numpad5,
  Numpad6: UiohookKey.Numpad6, Numpad7: UiohookKey.Numpad7,
  Numpad8: UiohookKey.Numpad8, Numpad9: UiohookKey.Numpad9,
  NumpadMultiply: UiohookKey.NumpadMultiply, NumpadAdd:      UiohookKey.NumpadAdd,
  NumpadSubtract: UiohookKey.NumpadSubtract, NumpadDecimal:  UiohookKey.NumpadDecimal,
  NumpadDivide:   UiohookKey.NumpadDivide,   NumpadEnter:    UiohookKey.NumpadEnter,
};

let pttMode = false;
let pttHeld = false;
let pttSuspended = false; // временно игнорируем события (захват новой клавиши)
let pttKeycode: number | null = null; // текущий keycode PTT — обновляется без перезапуска хука
let uiohookRunning = false;
let onPttStartCb: (() => void) | null = null;
let onPttStopCb:  (() => void) | null = null;

function getPttKeycode(code: string): number | null {
  return CODE_TO_UIOHOOK[code] ?? null;
}

// uiohook запускается один раз при входе в PTT-режим и НЕ останавливается
// до выхода из него — перезапуск ломает нативный callback в Electron.
function startPttHook(onStart: () => void, onStop: () => void): void {
  if (uiohookRunning) return;

  uIOhook.on('keydown', (e) => {
    if (pttSuspended || e.keycode !== pttKeycode || pttHeld) return;
    pttHeld = true;
    onStart();
  });

  uIOhook.on('keyup', (e) => {
    if (pttSuspended || e.keycode !== pttKeycode || !pttHeld) return;
    pttHeld = false;
    onStop();
  });

  uIOhook.start();
  uiohookRunning = true;
  console.log(`[HOTKEY] uiohook запущен (PTT)`);
}

function stopPttHook(): void {
  if (!uiohookRunning) return;
  uIOhook.removeAllListeners('keydown');
  uIOhook.removeAllListeners('keyup');
  uIOhook.stop();
  uiohookRunning = false;
  pttHeld = false;
  pttSuspended = false;
}

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

type HotkeyMode = 'double-tap' | 'push-to-talk';

let currentPttKey = ''; // e.code формат, пустой = используем currentAccel

function enterPttMode(): void {
  const keycode = getPttKeycode(currentPttKey || currentAccel);
  if (keycode === null) {
    console.warn(`[HOTKEY] PTT: клавиша не поддерживается, используйте F1–F12 или модификаторы`);
    return;
  }
  pttKeycode = keycode;
  pttSuspended = false;
  pttHeld = false;
  if (onPttStartCb && onPttStopCb) {
    startPttHook(onPttStartCb, onPttStopCb);
  }
  console.log(`[HOTKEY] PTT активен, keycode=${pttKeycode}`);
}

export function startHotkeyListener(
  onToggle: () => void,
  hotkey = 'F9',
  mode: HotkeyMode = 'double-tap',
  onPttStart?: () => void,
  onPttStop?: () => void,
  pttKey = '',
): void {
  onDoubleTapCb  = onToggle;
  onPttStartCb   = onPttStart ?? null;
  onPttStopCb    = onPttStop  ?? null;
  currentAccel   = sanitize(hotkey);
  currentPttKey  = pttKey;
  pttMode        = mode === 'push-to-talk';

  if (pttMode) {
    enterPttMode();
  } else {
    register(currentAccel);
    console.log(`[HOTKEY] Запущен. Двойной тап "${currentAccel}" — триггер.`);
  }
}

export function updateHotkey(hotkey: string): void {
  const oldAccel = currentAccel;
  currentAccel = sanitize(hotkey);
  lastTapTime  = 0;

  if (pttMode) {
    // Обновляем keycode без перезапуска хука
    const keycode = getPttKeycode(currentPttKey || currentAccel);
    if (keycode !== null) {
      pttKeycode = keycode;
      pttHeld = false;
      console.log(`[HOTKEY] PTT keycode → ${pttKeycode}`);
    }
  } else {
    try { globalShortcut.unregister(oldAccel); } catch {}
    register(currentAccel);
  }
  console.log(`[HOTKEY] Хоткей → "${currentAccel}"`);
}

export function updatePttKey(pttKey: string): void {
  currentPttKey = pttKey;
  if (pttMode) {
    // Просто обновляем keycode — хук продолжает работать
    const keycode = getPttKeycode(currentPttKey || currentAccel);
    if (keycode !== null) {
      pttKeycode = keycode;
      pttHeld = false;
      console.log(`[HOTKEY] PTT key → "${pttKey}", keycode=${pttKeycode}`);
    }
  }
}

export function updateHotkeyMode(mode: HotkeyMode): void {
  pttMode = mode === 'push-to-talk';

  if (pttMode) {
    try { globalShortcut.unregister(currentAccel); } catch {}
    enterPttMode();
  } else {
    stopPttHook();
    register(currentAccel);
  }
  console.log(`[HOTKEY] Режим → "${mode}"`);
}

export function suspendHotkey(): void {
  if (pttMode) {
    // Только приостанавливаем обработку — хук продолжает работать
    pttSuspended = true;
    pttHeld = false;
  } else {
    try { globalShortcut.unregister(currentAccel); } catch {}
  }
}

export function resumeHotkey(): void {
  if (pttMode) {
    pttSuspended = false;
  } else {
    register(currentAccel);
  }
}

export function stopHotkeyListener(): void {
  stopPttHook();
  globalShortcut.unregisterAll();
}
