require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const FormData = require('form-data');

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

    // Передаём аудио в OpenAI Whisper
    const formData = new FormData();
    formData.append('file', req.file.buffer, {
      filename: 'audio.webm',
      contentType: req.file.mimetype || 'audio/webm',
    });
    formData.append('model', 'whisper-1');
    if (language) formData.append('language', language);

    let prompt = '';
    if (dictionary) prompt += dictionary;
    if (instructions) prompt += (prompt ? '. ' : '') + instructions;
    if (prompt) formData.append('prompt', prompt);

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        ...formData.getHeaders(),
      },
      body: formData,
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[OpenAI error]', err);
      return res.status(502).json({ error: 'Ошибка OpenAI' });
    }

    const result = await response.json();
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

  // Проверяем что код существует и ещё не использован
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, referral_code')
    .eq('referral_code', code)
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

  // Активируем 1 месяц бесплатно
  const periodEnd = new Date();
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  await supabase
    .from('subscriptions')
    .update({ status: 'active', current_period_end: periodEnd.toISOString() })
    .eq('user_id', req.user.id);

  await supabase
    .from('profiles')
    .update({ referred_by: code })
    .eq('id', req.user.id);

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

// ── GET /health ───────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[server] Запущен на порту ${PORT}`));
