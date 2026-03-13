import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Отправляет аудиобуфер (WebM) в OpenAI Whisper API и возвращает текст.
 */
export async function transcribe(
  audioBuffer: Buffer,
  apiKey: string,
  language: string
): Promise<string> {
  const client = new OpenAI({ apiKey });

  // Сохраняем во временный файл — Whisper API требует file stream с именем
  const tmpPath = path.join(os.tmpdir(), `vt_audio_${Date.now()}.webm`);
  fs.writeFileSync(tmpPath, audioBuffer);

  try {
    const result = await client.audio.transcriptions.create({
      model: 'whisper-1',
      file: fs.createReadStream(tmpPath),
      language: language || undefined, // undefined = автоопределение
      prompt: 'Обычная разговорная речь. Транскрибируй дословно.',
    });
    return result.text.trim();
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}
