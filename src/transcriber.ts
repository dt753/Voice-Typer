const SERVER_URL = 'https://voice-typer-production.up.railway.app';

export async function transcribe(
  audioBuffer: Buffer,
  authToken: string,
  language: string,
  customInstructions = '',
  dictionary: string[] = [],
): Promise<string> {
  const arrayBuf = audioBuffer.buffer.slice(audioBuffer.byteOffset, audioBuffer.byteOffset + audioBuffer.byteLength) as ArrayBuffer;
  const blob = new Blob([arrayBuf], { type: 'audio/webm' });
  const form = new FormData();
  form.append('audio', blob, 'audio.webm');
  if (language) form.append('language', language);
  if (customInstructions) form.append('instructions', customInstructions);
  if (dictionary.length > 0) form.append('dictionary', dictionary.join(', '));

  const response = await fetch(`${SERVER_URL}/transcribe`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}` },
    body: form,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: response.statusText })) as any;
    if (response.status === 403 && err?.code === 'SUBSCRIPTION_INACTIVE') {
      throw Object.assign(new Error('Подписка неактивна'), { code: 'SUBSCRIPTION_INACTIVE' });
    }
    if (response.status === 401) {
      throw Object.assign(new Error('Необходимо войти в аккаунт'), { code: 'UNAUTHORIZED' });
    }
    throw new Error(err?.error || 'Ошибка сервера');
  }

  const result = await response.json() as { text: string };
  return result.text.trim();
}
