import { clipboard } from 'electron';
import { uIOhook, UiohookKey } from 'uiohook-napi';

/**
 * Вставляет текст в активное окно:
 * 1. Сохраняем текущий буфер обмена
 * 2. Пишем текст в буфер
 * 3. Инжектируем Ctrl+V через uiohook (драйверный уровень, не зависит от фокуса)
 * 4. Восстанавливаем буфер через 2 секунды
 */
export function injectText(text: string): void {
  const prev = clipboard.readText();
  clipboard.writeText(text);
  console.log(`[INJECT] Буфер обмена записан (${text.length} симв.), вставка…`);

  setTimeout(() => {
    try {
      // Mac: Cmd+V, Windows/Linux: Ctrl+V
      const mod = process.platform === 'darwin' ? UiohookKey.Meta : UiohookKey.Ctrl;
      uIOhook.keyTap(UiohookKey.V, [mod]);
      console.log('[INJECT] paste отправлен');
    } catch (err: any) {
      console.error('[INJECT] Ошибка:', err.message);
    }
    setTimeout(() => {
      try { clipboard.writeText(prev); } catch {}
    }, 2000);
  }, 100);
}
