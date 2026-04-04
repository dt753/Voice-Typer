"""
Voice Typer — аналог Aqua Voice для Windows.

Двойной тап Caps Lock → начало записи (иконка красная).
Ещё один двойной тап → стоп, транскрипция, вставка текста.
"""

import io
import os
import sys
import time
import wave
import threading

import numpy as np
import sounddevice as sd
import pyperclip
import pyautogui
import openai
from dotenv import load_dotenv
from pynput import keyboard as pynput_kb
import pystray
from PIL import Image, ImageDraw

load_dotenv()

# ── Настройки ────────────────────────────────────────────────────────────────
SAMPLE_RATE = 16_000          # Hz, оптимально для Whisper
CHANNELS = 1
DOUBLE_TAP_INTERVAL = 0.45   # секунды между нажатиями, чтобы считать двойным
LANGUAGE = "ru"               # язык для Whisper (None = автоопределение)
# ─────────────────────────────────────────────────────────────────────────────


def _make_icon(color: tuple) -> Image.Image:
    """Рисует круглую иконку для трея (64×64, RGBA)."""
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse([6, 6, 58, 58], fill=color)
    return img


ICON_IDLE = _make_icon((60, 200, 80))     # зелёная — ожидание
ICON_REC  = _make_icon((220, 45, 45))     # красная  — идёт запись
ICON_BUSY = _make_icon((230, 180, 0))     # жёлтая   — идёт транскрипция


class VoiceTyper:
    def __init__(self):
        api_key = os.getenv("OPENAI_API_KEY", "").strip()
        if not api_key:
            sys.exit("❌  Задайте OPENAI_API_KEY в файле .env")

        self.client = openai.OpenAI(api_key=api_key)
        self.is_recording = False
        self._audio_chunks: list[np.ndarray] = []
        self._stream: sd.InputStream | None = None
        self._lock = threading.Lock()

        self._last_tap_time = 0.0
        self._is_transcribing = False
        self._tray: pystray.Icon | None = None

    # ── Трей ─────────────────────────────────────────────────────────────────

    def _build_tray(self) -> pystray.Icon:
        menu = pystray.Menu(
            pystray.MenuItem("Выход", self._on_quit),
        )
        icon = pystray.Icon(
            "VoiceTyper",
            ICON_IDLE,
            "Voice Typer — ожидание",
            menu,
        )
        self._tray = icon
        return icon

    def _set_tray(self, icon_img: Image.Image, title: str) -> None:
        if self._tray:
            self._tray.icon = icon_img
            self._tray.title = title

    # ── Запись ───────────────────────────────────────────────────────────────

    def _audio_callback(self, indata: np.ndarray, frames, t, status) -> None:
        if self.is_recording:
            self._audio_chunks.append(indata.copy())

    def _start_recording(self) -> None:
        with self._lock:
            if self.is_recording or self._is_transcribing:
                return
            self.is_recording = True
            self._audio_chunks = []

        self._set_tray(ICON_REC, "Voice Typer — запись…")

        self._stream = sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=CHANNELS,
            dtype="float32",
            callback=self._audio_callback,
        )
        self._stream.start()
        print("[REC] Запись началась")

    def _stop_and_transcribe(self) -> None:
        with self._lock:
            if not self.is_recording:
                return
            self.is_recording = False

        if self._stream:
            self._stream.stop()
            self._stream.close()
            self._stream = None

        chunks = self._audio_chunks
        self._audio_chunks = []

        if not chunks:
            print("[WARN] Нет аудио")
            self._set_tray(ICON_IDLE, "Voice Typer — ожидание")
            return

        with self._lock:
            self._is_transcribing = True

        self._set_tray(ICON_BUSY, "Voice Typer — транскрипция…")
        print("[STT] Отправляю в Whisper…")

        # Собираем WAV в памяти
        audio = np.concatenate(chunks, axis=0)
        audio_int16 = (audio * 32_767).astype(np.int16)

        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(CHANNELS)
            wf.setsampwidth(2)
            wf.setframerate(SAMPLE_RATE)
            wf.writeframes(audio_int16.tobytes())
        buf.seek(0)
        buf.name = "audio.wav"

        try:
            resp = self.client.audio.transcriptions.create(
                model="whisper-1",
                file=buf,
                language=LANGUAGE,
            )
            text = resp.text.strip()
            print(f"[STT] Результат: {text!r}")
            if text:
                self._insert_text(text)
        except Exception as exc:
            print(f"[ERR] Ошибка транскрипции: {exc}")
        finally:
            with self._lock:
                self._is_transcribing = False
            self._set_tray(ICON_IDLE, "Voice Typer — ожидание")

    # ── Вставка текста ───────────────────────────────────────────────────────

    def _insert_text(self, text: str) -> None:
        """Вставляет текст через буфер обмена в активное окно."""
        try:
            old_clip = pyperclip.paste()
        except Exception:
            old_clip = ""

        pyperclip.copy(text)
        time.sleep(0.05)
        pyautogui.hotkey("ctrl", "v")

        # Восстанавливаем буфер через секунду
        def _restore():
            time.sleep(1.0)
            try:
                pyperclip.copy(old_clip)
            except Exception:
                pass

        threading.Thread(target=_restore, daemon=True).start()

    # ── Клавиатурный хук ─────────────────────────────────────────────────────

    def _on_press(self, key) -> None:
        if key != pynput_kb.Key.caps_lock:
            return

        now = time.time()
        delta = now - self._last_tap_time
        self._last_tap_time = now

        if delta < DOUBLE_TAP_INTERVAL:
            # Двойной тап — переключаем режим
            with self._lock:
                recording = self.is_recording
                busy = self._is_transcribing
            if busy:
                return
            if not recording:
                self._start_recording()
            else:
                threading.Thread(target=self._stop_and_transcribe, daemon=True).start()

    # ── Завершение ───────────────────────────────────────────────────────────

    def _on_quit(self) -> None:
        print("[EXIT] Выход…")
        if self.is_recording:
            self.is_recording = False
            if self._stream:
                self._stream.stop()
                self._stream.close()
        if self._tray:
            self._tray.stop()

    # ── Запуск ───────────────────────────────────────────────────────────────

    def run(self) -> None:
        kb_listener = pynput_kb.Listener(on_press=self._on_press)
        kb_listener.start()

        print("=" * 48)
        print("  Voice Typer запущен!")
        print("  Двойной тап Caps Lock — начать запись")
        print("  Двойной тап ещё раз  — стоп + вставка")
        print("  Трей → Выход          — закрыть")
        print("=" * 48)

        tray = self._build_tray()
        tray.run()          # блокирует, пока не вызовут tray.stop()

        kb_listener.stop()


if __name__ == "__main__":
    VoiceTyper().run()
