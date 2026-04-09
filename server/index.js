require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Supabase (service role — только на сервере, никогда не в клиенте)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(cors());
app.use(express.json());

// Rate limiting — не более 30 запросов в минуту с одного IP
const limiter = rateLimit({ windowMs: 60 * 1000, max: 30 });
app.use(limiter);

// ── Проверка JWT токена ────────────────────────────────────────────────────────
async function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Не авторизован' });
  }
  const token = auth.slice(7);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return res.status(401).json({ error: 'Токен недействителен' });
  }
  req.user = data.user;
  next();
}

// ── Проверка активной подписки ────────────────────────────────────────────────
async function requireSubscription(req, res, next) {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('status, current_period_end')
    .eq('user_id', req.user.id)
    .single();

  if (error || !data) {
    return res.status(403).json({ error: 'Подписка не найдена' });
  }

  const isActive =
    data.status === 'active' &&
    data.current_period_end &&
    new Date(data.current_period_end) > new Date();

  if (!isActive) {
    return res.status(403).json({ error: 'Подписка неактивна', code: 'SUBSCRIPTION_INACTIVE' });
  }

  next();
}

// ── POST /transcribe ──────────────────────────────────────────────────────────
app.post('/transcribe', requireAuth, requireSubscription, upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Аудио файл не передан' });
  }

  try {
    const { language, instructions, dictionary } = req.body;

    let prompt = '';
    if (dictionary) prompt += dictionary;
    if (instructions) prompt += (prompt ? '. ' : '') + instructions;

    // Используем OpenAI SDK — он сам обрабатывает multipart
    const { toFile } = require('openai');
    const file = await toFile(req.file.buffer, 'audio.webm', { type: req.file.mimetype || 'audio/webm' });

    const result = await openai.audio.transcriptions.create({
      model: 'whisper-1',
      file,
      language: language || undefined,
      prompt: prompt || undefined,
    });

    res.json({ text: result.text || '' });
  } catch (err) {
    console.error('[transcribe error]', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// ── POST /referral/apply ──────────────────────────────────────────────────────
app.post('/referral/apply', requireAuth, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Код не указан' });

  const normalizedCode = code.trim().toLowerCase();

  // Проверяем что код существует и ещё не использован
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, referral_code')
    .eq('referral_code', normalizedCode)
    .single();

  if (error || !profile) {
    return res.status(404).json({ error: 'Реферальный код не найден' });
  }

  if (profile.id === req.user.id) {
    return res.status(400).json({ error: 'Нельзя использовать свой код' });
  }

  // Проверяем что пользователь ещё не использовал реферальный код
  const { data: myProfile } = await supabase
    .from('profiles')
    .select('referred_by')
    .eq('id', req.user.id)
    .single();

  if (myProfile?.referred_by) {
    return res.status(400).json({ error: 'Реферальный код уже использован' });
  }

  // 1. Сначала помечаем referred_by — защита от повторного использования
  const { error: refByError } = await supabase
    .from('profiles')
    .update({ referred_by: normalizedCode })
    .eq('id', req.user.id);

  if (refByError) {
    return res.status(500).json({ error: 'Ошибка при активации кода' });
  }

  // 2. Активируем +1 месяц тому, кто ввёл код
  const { data: mySub } = await supabase
    .from('subscriptions')
    .select('current_period_end')
    .eq('user_id', req.user.id)
    .single();

  const myBase = mySub?.current_period_end && new Date(mySub.current_period_end) > new Date()
    ? new Date(mySub.current_period_end)
    : new Date();
  myBase.setDate(myBase.getDate() + 30);

  await supabase
    .from('subscriptions')
    .upsert({ user_id: req.user.id, status: 'active', current_period_end: myBase.toISOString() },
             { onConflict: 'user_id' });

  // 3. Награда рефереру — тоже +1 месяц
  const { data: refSub } = await supabase
    .from('subscriptions')
    .select('current_period_end')
    .eq('user_id', profile.id)
    .single();

  const refBase = refSub?.current_period_end && new Date(refSub.current_period_end) > new Date()
    ? new Date(refSub.current_period_end)
    : new Date();
  refBase.setDate(refBase.getDate() + 30);

  await supabase
    .from('subscriptions')
    .upsert({ user_id: profile.id, status: 'active', current_period_end: refBase.toISOString() },
             { onConflict: 'user_id' });

  res.json({ ok: true, message: '1 месяц бесплатного доступа активирован!' });
});

// ── GET /subscription ─────────────────────────────────────────────────────────
app.get('/subscription', requireAuth, async (req, res) => {
  const { data } = await supabase
    .from('subscriptions')
    .select('status, current_period_end')
    .eq('user_id', req.user.id)
    .single();

  const { data: profile } = await supabase
    .from('profiles')
    .select('referral_code, referred_by')
    .eq('id', req.user.id)
    .single();

  res.json({
    subscription: data,
    referral_code: profile?.referral_code,
    referred_by: profile?.referred_by,
  });
});

// ── GET /username ─────────────────────────────────────────────────────────────
app.get('/username', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', req.user.id)
    .single();
  if (error && error.code !== 'PGRST116') {
    return res.status(500).json({ error: 'Ошибка сервера' });
  }
  res.json({ username: data?.username ?? '' });
});

// ── POST /username ────────────────────────────────────────────────────────────
app.post('/username', requireAuth, async (req, res) => {
  const username = (req.body.username ?? '').trim();
  if (!username) return res.status(400).json({ error: 'Никнейм не может быть пустым' });
  if (username.length > 30) return res.status(400).json({ error: 'Максимум 30 символов' });
  if (!/^[A-Za-z0-9_\- а-яёА-ЯЁ]+$/.test(username)) {
    return res.status(400).json({ error: 'Только буквы, цифры, пробел, - и _' });
  }
  const { error } = await supabase
    .from('profiles')
    .update({ username })
    .eq('id', req.user.id);
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Этот никнейм уже занят' });
    return res.status(500).json({ error: 'Ошибка сохранения' });
  }
  res.json({ ok: true });
});

// ── GET /health ───────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[server] Запущен на порту ${PORT}`));
