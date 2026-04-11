import { clipboard } from 'electron';
import { uIOhook, UiohookKey } from 'uiohook-napi';

export function injectText(text: string): void {
  const prev = clipboard.readText();
  clipboard.writeText(text);
  console.log(`[INJECT] Буфер обмена записан (${text.length} симв.), вставка…`);

  setTimeout(() => {
    try {
      const mod = process.platform === 'darwin' ? UiohookKey.Meta : UiohookKey.Ctrl;
      uIOhook.keyTap(UiohookKey.V, [mod]);
      console.log('[INJECT] paste отправлен (uiohook)');
    } catch (err: any) {
      console.error('[INJECT] Ошибка:', err.message);
    }
    setTimeout(() => {
      try { clipboard.writeText(prev); } catch {}
    }, 2000);
  }, process.platform === 'darwin' ? 300 : 100);
}
