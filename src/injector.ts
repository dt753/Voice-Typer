import { clipboard } from 'electron';
import { uIOhook, UiohookKey } from 'uiohook-napi';
import { exec } from 'child_process';

export function injectText(text: string): void {
  const prev = clipboard.readText();
  clipboard.writeText(text);
  console.log(`[INJECT] Буфер обмена записан (${text.length} симв.), вставка…`);

  setTimeout(() => {
    if (process.platform === 'darwin') {
      // На macOS используем AppleScript — надёжнее uiohook
      exec(`osascript -e 'tell application "System Events" to keystroke "v" using {command down}'`, (err) => {
        if (err) console.error('[INJECT] osascript ошибка:', err.message);
        else console.log('[INJECT] paste отправлен (osascript)');
      });
    } else {
      try {
        uIOhook.keyTap(UiohookKey.V, [UiohookKey.Ctrl]);
        console.log('[INJECT] paste отправлен (uiohook)');
      } catch (err: any) {
        console.error('[INJECT] Ошибка:', err.message);
      }
    }
    setTimeout(() => {
      try { clipboard.writeText(prev); } catch {}
    }, 2000);
  }, process.platform === 'darwin' ? 300 : 100);
}
