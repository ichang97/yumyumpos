import { Hono } from 'hono';
import { requireAdmin } from '../lib/accessAuth.js';
import { prepareStmt, queryAll } from '../lib/db.js';
import { getBangkokNow } from '../lib/time.js';
import { HttpError, optionalString, parseJsonBody, requireString } from '../lib/validate.js';

export const SPEECH_PUBLIC_SETTING_KEYS = [
  'speech_source',
  'speech_rate',
  'ai_studio_model',
  'ai_studio_voice',
  'ai_studio_temperature',
  'ai_studio_style_prompt',
];

export const AI_STUDIO_API_KEY_SETTING = 'ai_studio_api_key';

export const DEFAULT_SPEECH_SOURCE = 'web_speech';
export const DEFAULT_SPEECH_RATE = 1.15;
export const DEFAULT_AI_STUDIO_MODEL = 'gemini-2.5-flash-preview-tts';
export const DEFAULT_AI_STUDIO_VOICE = 'Zephyr';
export const DEFAULT_AI_STUDIO_TEMPERATURE = 1.0;

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL_ID_RE = /^[a-zA-Z0-9._-]{3,100}$/;
const VOICE_NAME_RE = /^[a-zA-Z0-9._-]{1,100}$/;
const API_KEY_RE = /^[\x21-\x7E]{10,256}$/;

export const FALLBACK_AI_STUDIO_VOICES = [
  { name: 'Zephyr', display_name: 'Zephyr', description: 'Bright' },
  { name: 'Puck', display_name: 'Puck', description: 'Upbeat' },
  { name: 'Charon', display_name: 'Charon', description: 'Informative' },
  { name: 'Kore', display_name: 'Kore', description: 'Firm' },
  { name: 'Fenrir', display_name: 'Fenrir', description: 'Excitable' },
  { name: 'Leda', display_name: 'Leda', description: 'Youthful' },
  { name: 'Orus', display_name: 'Orus', description: 'Firm' },
  { name: 'Aoede', display_name: 'Aoede', description: 'Breezy' },
  { name: 'Callirrhoe', display_name: 'Callirrhoe', description: 'Easy-going' },
  { name: 'Autonoe', display_name: 'Autonoe', description: 'Bright' },
  { name: 'Enceladus', display_name: 'Enceladus', description: 'Breathy' },
  { name: 'Iapetus', display_name: 'Iapetus', description: 'Clear' },
  { name: 'Umbriel', display_name: 'Umbriel', description: 'Easy-going' },
  { name: 'Algieba', display_name: 'Algieba', description: 'Smooth' },
  { name: 'Despina', display_name: 'Despina', description: 'Smooth' },
  { name: 'Erinome', display_name: 'Erinome', description: 'Clear' },
  { name: 'Algenib', display_name: 'Algenib', description: 'Gravelly' },
  { name: 'Rasalgethi', display_name: 'Rasalgethi', description: 'Informative' },
  { name: 'Laomedeia', display_name: 'Laomedeia', description: 'Upbeat' },
  { name: 'Achernar', display_name: 'Achernar', description: 'Soft' },
  { name: 'Alnilam', display_name: 'Alnilam', description: 'Firm' },
  { name: 'Schedar', display_name: 'Schedar', description: 'Even' },
  { name: 'Gacrux', display_name: 'Gacrux', description: 'Mature' },
  { name: 'Pulcherrima', display_name: 'Pulcherrima', description: 'Forward' },
  { name: 'Achird', display_name: 'Achird', description: 'Friendly' },
  { name: 'Zubenelgenubi', display_name: 'Zubenelgenubi', description: 'Casual' },
  { name: 'Vindemiatrix', display_name: 'Vindemiatrix', description: 'Gentle' },
  { name: 'Sadachbia', display_name: 'Sadachbia', description: 'Lively' },
  { name: 'Sadaltager', display_name: 'Sadaltager', description: 'Knowledgeable' },
  { name: 'Sulafat', display_name: 'Sulafat', description: 'Warm' },
];

export function normalizeSpeechSource(value, strict = false) {
  if (value === undefined || value === null || value === '') {
    if (strict) {
      throw new HttpError(400, 'กรุณาเลือกแหล่งเสียง');
    }
    return DEFAULT_SPEECH_SOURCE;
  }
  if (value === 'web_speech' || value === 'ai_studio') {
    return value;
  }
  if (strict) {
    throw new HttpError(400, 'แหล่งเสียงที่เลือกไม่ถูกต้อง');
  }
  return DEFAULT_SPEECH_SOURCE;
}

export function validateSpeechRate(value, strict = true) {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return DEFAULT_SPEECH_RATE;
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0.8 || num > 2.0) {
    if (strict) {
      throw new HttpError(400, 'ความเร็วเสียงต้องอยู่ระหว่าง 0.8 ถึง 2.0 เท่า');
    }
    return DEFAULT_SPEECH_RATE;
  }
  return Math.round(num * 100) / 100;
}

export function validateTemperature(value, strict = true) {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return DEFAULT_AI_STUDIO_TEMPERATURE;
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0 || num > 2) {
    if (strict) {
      throw new HttpError(400, 'ค่า Temperature ต้องอยู่ระหว่าง 0.0 ถึง 2.0');
    }
    return DEFAULT_AI_STUDIO_TEMPERATURE;
  }
  return Math.round(num * 100) / 100;
}

export function validateModelId(value, strict = true) {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    if (strict) {
      throw new HttpError(400, 'กรุณาระบุชื่อโมเดลเสียง');
    }
    return DEFAULT_AI_STUDIO_MODEL;
  }
  if (typeof value !== 'string') {
    if (strict) {
      throw new HttpError(400, 'รูปแบบชื่อโมเดลไม่ถูกต้อง');
    }
    return DEFAULT_AI_STUDIO_MODEL;
  }
  const cleaned = value.trim().replace(/^models\//i, '');
  if (!MODEL_ID_RE.test(cleaned) || cleaned.includes('..')) {
    if (strict) {
      throw new HttpError(400, 'ชื่อโมเดลเสียงไม่ถูกต้อง');
    }
    return DEFAULT_AI_STUDIO_MODEL;
  }
  return cleaned;
}

export function validateVoiceName(value, strict = true) {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    if (strict) {
      throw new HttpError(400, 'กรุณาเลือกเสียงพูด');
    }
    return DEFAULT_AI_STUDIO_VOICE;
  }
  if (typeof value !== 'string') {
    if (strict) {
      throw new HttpError(400, 'รูปแบบชื่อเสียงพูดไม่ถูกต้อง');
    }
    return DEFAULT_AI_STUDIO_VOICE;
  }
  const cleaned = value.trim().replace(/^voices\//i, '');
  if (!VOICE_NAME_RE.test(cleaned) || cleaned.includes('..')) {
    if (strict) {
      throw new HttpError(400, 'ชื่อเสียงพูดไม่ถูกต้อง');
    }
    return DEFAULT_AI_STUDIO_VOICE;
  }
  return cleaned;
}

export function validateStylePrompt(value) {
  return optionalString(value, 400) || '';
}

export function validateApiKey(value) {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'รูปแบบ Gemini API Key ไม่ถูกต้อง');
  }
  const trimmed = value.trim();
  if (!API_KEY_RE.test(trimmed)) {
    throw new HttpError(400, 'Gemini API Key ต้องมีความยาว 10-256 ตัวอักษรและไม่มีช่องว่าง');
  }
  return trimmed;
}

export function maskApiKey(rawKey) {
  const trimmed = String(rawKey || '').trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.length < 10) {
    return '••••••••';
  }
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

async function loadSpeechSettingsFromDb(db) {
  const keys = [...SPEECH_PUBLIC_SETTING_KEYS, AI_STUDIO_API_KEY_SETTING];
  const placeholders = keys.map(() => '?').join(', ');
  const rows = await queryAll(
    db,
    `SELECT key, value FROM shop_settings WHERE key IN (${placeholders})`,
    keys
  );
  const map = new Map(rows.map((row) => [row.key, row.value]));

  const rawApiKey = String(map.get(AI_STUDIO_API_KEY_SETTING) || '').trim();

  return {
    source: normalizeSpeechSource(map.get('speech_source'), false),
    rate: validateSpeechRate(map.get('speech_rate'), false),
    model: validateModelId(map.get('ai_studio_model'), false),
    voice: validateVoiceName(map.get('ai_studio_voice'), false),
    temperature: validateTemperature(map.get('ai_studio_temperature'), false),
    style_prompt: String(map.get('ai_studio_style_prompt') || '').slice(0, 400),
    rawApiKey,
  };
}

function toAdminSpeechResponse(settings) {
  return {
    source: settings.source,
    rate: settings.rate,
    model: settings.model,
    voice: settings.voice,
    temperature: settings.temperature,
    style_prompt: settings.style_prompt,
    has_api_key: Boolean(settings.rawApiKey),
    api_key_masked: maskApiKey(settings.rawApiKey),
  };
}

function toRuntimeSpeechResponse(settings) {
  return {
    source: settings.source,
    rate: settings.rate,
    ai_studio_ready: Boolean(settings.rawApiKey && settings.model && settings.voice),
  };
}

async function fetchWithTimeout(url, options, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeGeminiVoiceList(rawVoices) {
  if (!Array.isArray(rawVoices)) {
    return [];
  }
  const seen = new Set();
  const voices = [];
  for (const item of rawVoices) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const rawName = String(item.name || '').trim().replace(/^voices\//i, '');
    if (!VOICE_NAME_RE.test(rawName) || rawName.includes('..') || seen.has(rawName)) {
      continue;
    }
    seen.add(rawName);
    const displayName = String(item.displayName || item.display_name || rawName).trim() || rawName;
    const gender = String(item.ssmlGender || item.gender || '').trim();
    const langs = Array.isArray(item.languageCodes)
      ? item.languageCodes.filter((code) => typeof code === 'string' && code.trim())
      : [];
    const descParts = [
      String(item.description || item.style || '').trim(),
      gender,
      langs.length > 0 ? langs.slice(0, 3).join(', ') : '',
    ].filter(Boolean);
    voices.push({
      name: rawName,
      display_name: displayName,
      description: descParts.join(' • '),
      gender,
      language_codes: langs,
    });
  }
  return voices;
}

async function fetchGeminiModels(apiKey) {
  const collected = [];
  let pageToken = '';

  for (let page = 0; page < 3; page += 1) {
    const url = new URL(`${GEMINI_API_BASE}/models`);
    url.searchParams.set('pageSize', '200');
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }

    let response;
    try {
      response = await fetchWithTimeout(
        url.toString(),
        {
          method: 'GET',
          headers: {
            'x-goog-api-key': apiKey,
          },
        },
        15000
      );
    } catch (err) {
      if (err?.name === 'AbortError') {
        throw new HttpError(504, 'การดึงรายชื่อโมเดลจาก Google AI Studio ใช้เวลานานเกินกำหนด');
      }
      throw new HttpError(502, 'ไม่สามารถเชื่อมต่อ Google AI Studio ได้ในขณะนี้');
    }

    if (!response.ok) {
      if (response.status === 400 || response.status === 401 || response.status === 403) {
        throw new HttpError(400, 'Gemini API Key ไม่ถูกต้องหรือไม่มีสิทธิ์เข้าถึง');
      }
      if (response.status === 429) {
        throw new HttpError(429, 'เรียกใช้ Gemini API เกินโควตาชั่วคราว กรุณารอสักครู่');
      }
      throw new HttpError(502, 'ไม่สามารถดึงรายชื่อโมเดลจาก Google AI Studio ได้');
    }

    const data = await response.json().catch(() => null);
    const items = Array.isArray(data?.models) ? data.models : [];
    collected.push(...items);
    pageToken = typeof data?.nextPageToken === 'string' ? data.nextPageToken.trim() : '';
    if (!pageToken) {
      break;
    }
  }

  const seen = new Set();
  const ttsModels = [];
  const allGenerateModels = [];

  for (const model of collected) {
    if (!model || typeof model !== 'object') {
      continue;
    }
    const methods = Array.isArray(model.supportedGenerationMethods)
      ? model.supportedGenerationMethods
      : [];
    if (!methods.includes('generateContent')) {
      continue;
    }
    const id = String(model.name || '').trim().replace(/^models\//i, '');
    if (!MODEL_ID_RE.test(id) || id.includes('..') || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const displayName = String(model.displayName || id).trim() || id;
    const description = String(model.description || '').trim();
    const entry = {
      id,
      display_name: displayName,
      description,
    };
    allGenerateModels.push(entry);
    if (id.toLowerCase().includes('tts') || displayName.toLowerCase().includes('tts')) {
      ttsModels.push(entry);
    }
  }

  return ttsModels.length > 0 ? ttsModels : allGenerateModels;
}

async function fetchGeminiVoices(apiKey) {
  try {
    const response = await fetchWithTimeout(
      `${GEMINI_API_BASE}/voices`,
      {
        method: 'GET',
        headers: {
          'x-goog-api-key': apiKey,
        },
      },
      10000
    );
    if (!response.ok) {
      return { voices: FALLBACK_AI_STUDIO_VOICES, voices_source: 'fallback' };
    }
    const data = await response.json().catch(() => null);
    const normalized = normalizeGeminiVoiceList(data?.voices);
    if (normalized.length > 0) {
      return { voices: normalized, voices_source: 'api' };
    }
  } catch {
  }
  return { voices: FALLBACK_AI_STUDIO_VOICES, voices_source: 'fallback' };
}

async function fetchGeminiCatalog(apiKey) {
  const [modelsResult, voicesResult] = await Promise.allSettled([
    fetchGeminiModels(apiKey),
    fetchGeminiVoices(apiKey),
  ]);

  if (modelsResult.status === 'rejected') {
    throw modelsResult.reason;
  }

  const voiceData =
    voicesResult.status === 'fulfilled'
      ? voicesResult.value
      : { voices: FALLBACK_AI_STUDIO_VOICES, voices_source: 'fallback' };

  return {
    models: modelsResult.value,
    voices: voiceData.voices,
    voices_source: voiceData.voices_source,
  };
}

function parseSampleRate(mimeType) {
  const match = /rate=(\d+)/i.exec(String(mimeType || ''));
  if (!match) {
    return 24000;
  }
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed >= 8000 && parsed <= 96000 ? parsed : 24000;
}

async function postGeminiSpeechRequest(endpoint, apiKey, body) {
  try {
    return await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(body),
      },
      15000
    );
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new HttpError(504, 'การสร้างเสียงจาก Google AI Studio ใช้เวลานานเกินกำหนด');
    }
    throw new HttpError(502, 'ไม่สามารถเชื่อมต่อ Google AI Studio ได้ในขณะนี้');
  }
}

async function synthesizeGeminiAudio({ apiKey, model, voice, temperature, stylePrompt, text }) {
  const endpoint = `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`;
  const generationConfig = {
    responseModalities: ['AUDIO'],
    temperature,
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: voice,
        },
      },
    },
  };

  const part = stylePrompt
    ? { text, speechMetadata: { style: stylePrompt } }
    : { text };

  let response = await postGeminiSpeechRequest(endpoint, apiKey, {
    contents: [{ role: 'user', parts: [part] }],
    generationConfig,
  });

  if (response.status === 400 && stylePrompt) {
    response = await postGeminiSpeechRequest(endpoint, apiKey, {
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig,
    });
  }

  if (!response.ok) {
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      throw new HttpError(400, 'Gemini API Key ไม่ถูกต้องหรือพารามิเตอร์ไม่รองรับกับโมเดลที่เลือก');
    }
    if (response.status === 404) {
      throw new HttpError(400, 'ไม่พบโมเดลเสียงที่เลือก กรุณารีเฟรชรายชื่อโมเดลจาก API');
    }
    if (response.status === 429) {
      throw new HttpError(429, 'ใช้งาน Gemini API เกินโควตาชั่วคราว กรุณารอสักครู่');
    }
    throw new HttpError(502, 'ไม่สามารถสร้างเสียงจาก Google AI Studio ได้ในขณะนี้');
  }

  const data = await response.json().catch(() => null);
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];

  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    for (const part of parts) {
      const inline = part?.inlineData || part?.inline_data;
      if (inline && typeof inline.data === 'string' && inline.data.length > 0) {
        const mimeType = String(inline.mimeType || inline.mime_type || 'audio/L16;codec=pcm;rate=24000');
        return {
          audio_base64: inline.data,
          mime_type: mimeType,
          sample_rate: parseSampleRate(mimeType),
        };
      }
    }
  }

  throw new HttpError(502, 'โมเดลไม่ได้ส่งข้อมูลเสียงกลับมา กรุณาตรวจสอบโมเดลหรือข้อความที่ใช้');
}

export function createSpeechRoutes() {
  const router = new Hono();

  router.get('/speech/runtime', async (c) => {
    c.header('Cache-Control', 'no-store');
    const settings = await loadSpeechSettingsFromDb(c.env.DB);
    return c.json({ speech: toRuntimeSpeechResponse(settings) });
  });

  router.get('/settings/speech', requireAdmin, async (c) => {
    c.header('Cache-Control', 'no-store');
    const settings = await loadSpeechSettingsFromDb(c.env.DB);
    return c.json({
      speech: toAdminSpeechResponse(settings),
      default_voices: FALLBACK_AI_STUDIO_VOICES,
    });
  });

  router.put('/settings/speech', requireAdmin, async (c) => {
    c.header('Cache-Control', 'no-store');
    const body = await parseJsonBody(c);
    const current = await loadSpeechSettingsFromDb(c.env.DB);

    const source = normalizeSpeechSource(body.source, true);
    const rate = validateSpeechRate(body.rate, true);
    const model =
      body.model !== undefined
        ? validateModelId(body.model, true)
        : current.model;
    const voice =
      body.voice !== undefined
        ? validateVoiceName(body.voice, true)
        : current.voice;
    const temperature =
      body.temperature !== undefined
        ? validateTemperature(body.temperature, true)
        : current.temperature;
    const stylePrompt =
      body.style_prompt !== undefined
        ? validateStylePrompt(body.style_prompt)
        : current.style_prompt;

    let nextApiKey = current.rawApiKey;
    let apiKeyUpdated = false;
    if (body.clear_api_key === true) {
      nextApiKey = '';
      apiKeyUpdated = Boolean(current.rawApiKey);
    } else if (typeof body.api_key === 'string' && body.api_key.trim() !== '') {
      nextApiKey = validateApiKey(body.api_key);
      apiKeyUpdated = true;
    }

    if (source === 'ai_studio' && !nextApiKey) {
      throw new HttpError(400, 'กรุณาตั้งค่า Gemini API Key ก่อนเลือกใช้งาน Google AI Studio');
    }

    const now = getBangkokNow();
    const entries = [
      ['speech_source', source],
      ['speech_rate', String(rate)],
      ['ai_studio_model', model],
      ['ai_studio_voice', voice],
      ['ai_studio_temperature', String(temperature)],
      ['ai_studio_style_prompt', stylePrompt],
      [AI_STUDIO_API_KEY_SETTING, nextApiKey],
    ];

    const stmts = entries.map(([key, value]) =>
      prepareStmt(
        c.env.DB,
        'INSERT INTO shop_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
        [key, value, now]
      )
    );

    await c.env.DB.batch(stmts);
    const updated = await loadSpeechSettingsFromDb(c.env.DB);

    console.log(
      JSON.stringify({
        event: 'speech_settings_updated',
        actor: c.get('authUser')?.email || 'unknown',
        source: updated.source,
        model: updated.model,
        voice: updated.voice,
        has_api_key: Boolean(updated.rawApiKey),
        api_key_updated: apiKeyUpdated,
        at: now,
      })
    );

    return c.json({ speech: toAdminSpeechResponse(updated) });
  });

  router.post('/speech/catalog', requireAdmin, async (c) => {
    c.header('Cache-Control', 'no-store');
    const body = await parseJsonBody(c);
    const current = await loadSpeechSettingsFromDb(c.env.DB);

    let effectiveKey = current.rawApiKey;
    if (typeof body.api_key === 'string' && body.api_key.trim() !== '') {
      effectiveKey = validateApiKey(body.api_key);
    }

    if (!effectiveKey) {
      throw new HttpError(400, 'กรุณากรอกหรือบันทึก Gemini API Key ก่อนโหลดรายชื่อโมเดลและเสียง');
    }

    const catalog = await fetchGeminiCatalog(effectiveKey);
    return c.json(catalog);
  });

  router.post('/speech/preview', requireAdmin, async (c) => {
    c.header('Cache-Control', 'no-store');
    const body = await parseJsonBody(c);
    const current = await loadSpeechSettingsFromDb(c.env.DB);

    const text = requireString(body.text, 'ข้อความทดสอบ', 500);
    const model =
      body.model !== undefined
        ? validateModelId(body.model, true)
        : current.model;
    const voice =
      body.voice !== undefined
        ? validateVoiceName(body.voice, true)
        : current.voice;
    const temperature =
      body.temperature !== undefined
        ? validateTemperature(body.temperature, true)
        : current.temperature;
    const stylePrompt =
      body.style_prompt !== undefined
        ? validateStylePrompt(body.style_prompt)
        : current.style_prompt;

    let effectiveKey = current.rawApiKey;
    if (typeof body.api_key === 'string' && body.api_key.trim() !== '') {
      effectiveKey = validateApiKey(body.api_key);
    }

    if (!effectiveKey) {
      throw new HttpError(400, 'กรุณากรอกหรือบันทึก Gemini API Key ก่อนทดลองฟังเสียง');
    }

    const audio = await synthesizeGeminiAudio({
      apiKey: effectiveKey,
      model,
      voice,
      temperature,
      stylePrompt,
      text,
    });

    return c.json(audio);
  });

  router.post('/speech/speak', async (c) => {
    c.header('Cache-Control', 'no-store');
    const body = await parseJsonBody(c);
    const text = requireString(body.text, 'ข้อความอ่านคิว', 500);

    const settings = await loadSpeechSettingsFromDb(c.env.DB);
    if (settings.source !== 'ai_studio') {
      throw new HttpError(400, 'ระบบไม่ได้เปิดใช้งานแหล่งเสียง Google AI Studio');
    }
    if (!settings.rawApiKey) {
      throw new HttpError(400, 'ยังไม่ได้ตั้งค่า Gemini API Key');
    }

    const audio = await synthesizeGeminiAudio({
      apiKey: settings.rawApiKey,
      model: settings.model,
      voice: settings.voice,
      temperature: settings.temperature,
      stylePrompt: settings.style_prompt,
      text,
    });

    return c.json(audio);
  });

  return router;
}
