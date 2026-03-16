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
  language: string,
  customInstructions = '',
  dictionary: string[] = [],
): Promise<string> {
  const client = new OpenAI({ apiKey });

  // Собираем промпт: инструкции + словарь
  const promptParts: string[] = [];
  if (customInstructions) promptParts.push(customInstructions);
  if (dictionary.length > 0) promptParts.push(dictionary.join(', '));
  const prompt = promptParts.length > 0
    ? promptParts.join('\n')
    : 'Обычная разговорная речь. Транскрибируй дословно.';

  // Сохраняем во временный файл — Whisper API требует file stream с именем
  const tmpPath = path.join(os.tmpdir(), `vt_audio_${Date.now()}.webm`);
  fs.writeFileSync(tmpPath, audioBuffer);

  try {
    const result = await client.audio.transcriptions.create({
      model: 'whisper-1',
      file: fs.createReadStream(tmpPath),
      language: language || undefined,
      prompt,
    });
    return result.text.trim();
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}
