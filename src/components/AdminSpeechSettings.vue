<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  Volume2,
} from 'lucide-vue-next';
import { api } from '../api/client.js';
import {
  DEFAULT_PREVIEW_TEXT,
  DEFAULT_SPEECH_RATE,
  SPEECH_RATE_OPTIONS,
  SPEECH_STYLE_PRESETS,
  isSpeechSupported,
  normalizeSpeechRate,
  pcmBase64ToWavBlob,
  speakThai,
  stopSpeech,
} from '../utils/kitchenSpeech.js';

const emit = defineEmits(['notify']);

const loadingSettings = ref(true);
const saving = ref(false);
const catalogLoading = ref(false);
const catalogLoaded = ref(false);
const catalogError = ref('');
const voicesSource = ref('fallback');

const hasApiKey = ref(false);
const apiKeyMasked = ref('');
const apiKeyInput = ref('');
const showApiKey = ref(false);
const clearApiKeyFlag = ref(false);
const customModelMode = ref(false);

const form = ref({
  source: 'web_speech',
  rate: DEFAULT_SPEECH_RATE,
  model: 'gemini-2.5-flash-preview-tts',
  voice: 'Zephyr',
  temperature: 1.0,
  style_prompt: '',
});

const models = ref([]);
const voices = ref([]);

const previewText = ref(DEFAULT_PREVIEW_TEXT);
const previewLoading = ref(false);
const previewAudioUrl = ref('');
const previewPlaying = ref(false);
const previewCurrentTime = ref(0);
const previewDuration = ref(0);
const previewMeta = ref(null);
const webSpeechPlaying = ref(false);
const speechSupported = isSpeechSupported();

let playerAudio = null;
let previewController = null;

const effectiveHasKey = computed(() => {
  if (apiKeyInput.value.trim()) {
    return true;
  }
  return hasApiKey.value && !clearApiKeyFlag.value;
});

const modelOptions = computed(() => {
  const list = [...models.value];
  const current = String(form.value.model || '').trim();
  if (current && !list.some((m) => m.id === current)) {
    list.unshift({
      id: current,
      display_name: current,
      description: '',
    });
  }
  return list;
});

const voiceOptions = computed(() => {
  const list = [...voices.value];
  const current = String(form.value.voice || '').trim();
  if (current && !list.some((v) => v.name === current)) {
    list.unshift({
      name: current,
      display_name: current,
      description: '',
    });
  }
  return list;
});

const selectedVoiceInfo = computed(() =>
  voiceOptions.value.find((v) => v.name === form.value.voice) || null
);

function formatSeconds(sec) {
  const total = Math.max(0, Math.floor(Number(sec) || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function cleanupPlayerAudio() {
  if (playerAudio) {
    playerAudio.onloadedmetadata = null;
    playerAudio.ontimeupdate = null;
    playerAudio.onplay = null;
    playerAudio.onpause = null;
    playerAudio.onended = null;
    playerAudio.onerror = null;
    try {
      playerAudio.pause();
      playerAudio.removeAttribute('src');
      playerAudio.load();
    } catch {
    }
    playerAudio = null;
  }
  previewPlaying.value = false;
  previewCurrentTime.value = 0;
  previewDuration.value = 0;
}

function revokePreviewAudioUrl() {
  if (previewAudioUrl.value) {
    URL.revokeObjectURL(previewAudioUrl.value);
    previewAudioUrl.value = '';
  }
  previewMeta.value = null;
}

function stopPreviewPlayback() {
  if (previewController) {
    previewController.abort();
    previewController = null;
  }
  stopSpeech();
  webSpeechPlaying.value = false;
  if (playerAudio) {
    playerAudio.pause();
    playerAudio.currentTime = 0;
  }
  previewPlaying.value = false;
  previewCurrentTime.value = 0;
}

watch(
  () => form.value.rate,
  (nextRate) => {
    if (playerAudio) {
      playerAudio.playbackRate = normalizeSpeechRate(nextRate);
    }
  }
);

watch(apiKeyInput, (val) => {
  if (val.trim() !== '') {
    clearApiKeyFlag.value = false;
  }
});

async function loadCatalog({ silent = false } = {}) {
  if (catalogLoading.value) {
    return;
  }
  if (!effectiveHasKey.value) {
    if (!silent) {
      emit('notify', {
        type: 'error',
        text: 'กรุณากรอกหรือบันทึก Gemini API Key ก่อนโหลดรายชื่อโมเดลและเสียง',
      });
    }
    return;
  }

  catalogLoading.value = true;
  catalogError.value = '';
  try {
    const payload = {};
    if (apiKeyInput.value.trim()) {
      payload.api_key = apiKeyInput.value.trim();
    }
    const res = await api.getSpeechCatalog(payload);
    models.value = Array.isArray(res.models) ? res.models : [];
    if (Array.isArray(res.voices) && res.voices.length > 0) {
      voices.value = res.voices;
      voicesSource.value = res.voices_source || 'api';
    }
    catalogLoaded.value = true;
    if (models.value.length > 0 && !models.value.some((m) => m.id === form.value.model)) {
      form.value.model = models.value[0].id;
    }
    if (voices.value.length > 0 && !voices.value.some((v) => v.name === form.value.voice)) {
      form.value.voice = voices.value[0].name;
    }
    if (!silent) {
      emit('notify', {
        type: 'success',
        text: `โหลดจาก API สำเร็จ (${models.value.length} โมเดล, ${voices.value.length} เสียง)`,
      });
    }
  } catch (err) {
    catalogError.value = err.message;
    if (!silent) {
      emit('notify', { type: 'error', text: err.message });
    }
  } finally {
    catalogLoading.value = false;
  }
}

async function loadSettings() {
  loadingSettings.value = true;
  try {
    const res = await api.getSpeechSettings();
    const speech = res?.speech || {};
    form.value = {
      source: speech.source === 'ai_studio' ? 'ai_studio' : 'web_speech',
      rate: normalizeSpeechRate(speech.rate),
      model: speech.model || 'gemini-2.5-flash-preview-tts',
      voice: speech.voice || 'Zephyr',
      temperature: Number.isFinite(Number(speech.temperature)) ? Number(speech.temperature) : 1.0,
      style_prompt: speech.style_prompt || '',
    };
    hasApiKey.value = Boolean(speech.has_api_key);
    apiKeyMasked.value = speech.api_key_masked || '';
    apiKeyInput.value = '';
    clearApiKeyFlag.value = false;
    if (Array.isArray(res?.default_voices) && res.default_voices.length > 0) {
      voices.value = res.default_voices;
      voicesSource.value = 'fallback';
    }
    if (hasApiKey.value) {
      loadCatalog({ silent: true });
    }
  } catch (err) {
    emit('notify', { type: 'error', text: err.message });
  } finally {
    loadingSettings.value = false;
  }
}

function toggleClearApiKey() {
  clearApiKeyFlag.value = !clearApiKeyFlag.value;
  if (clearApiKeyFlag.value) {
    apiKeyInput.value = '';
    showApiKey.value = false;
  }
}

async function saveSettings() {
  if (saving.value) {
    return;
  }
  if (form.value.source === 'ai_studio' && !effectiveHasKey.value) {
    emit('notify', {
      type: 'error',
      text: 'กรุณาตั้งค่า Gemini API Key ก่อนเลือกใช้งาน Google AI Studio',
    });
    return;
  }

  saving.value = true;
  try {
    const payload = {
      source: form.value.source,
      rate: normalizeSpeechRate(form.value.rate),
      model: String(form.value.model || '').trim(),
      voice: String(form.value.voice || '').trim(),
      temperature: Number(form.value.temperature),
      style_prompt: form.value.style_prompt,
    };
    if (clearApiKeyFlag.value) {
      payload.clear_api_key = true;
    } else if (apiKeyInput.value.trim()) {
      payload.api_key = apiKeyInput.value.trim();
    }

    const res = await api.updateSpeechSettings(payload);
    const updated = res?.speech || {};
    hasApiKey.value = Boolean(updated.has_api_key);
    apiKeyMasked.value = updated.api_key_masked || '';
    apiKeyInput.value = '';
    showApiKey.value = false;
    clearApiKeyFlag.value = false;
    form.value = {
      source: updated.source || form.value.source,
      rate: normalizeSpeechRate(updated.rate),
      model: updated.model || form.value.model,
      voice: updated.voice || form.value.voice,
      temperature: Number.isFinite(Number(updated.temperature)) ? Number(updated.temperature) : 1.0,
      style_prompt: updated.style_prompt || '',
    };

    emit('notify', { type: 'success', text: 'บันทึกการตั้งค่าเสียงอ่านคิวเรียบร้อยแล้ว' });
    if (hasApiKey.value && !catalogLoaded.value) {
      loadCatalog({ silent: true });
    }
  } catch (err) {
    emit('notify', { type: 'error', text: err.message });
  } finally {
    saving.value = false;
  }
}

async function runPreview() {
  const targetText = String(previewText.value || '').trim();
  if (!targetText) {
    emit('notify', { type: 'error', text: 'กรุณากรอกข้อความสำหรับทดลองฟังเสียง' });
    return;
  }

  stopPreviewPlayback();

  if (form.value.source === 'web_speech') {
    if (!speechSupported) {
      emit('notify', { type: 'error', text: 'เบราว์เซอร์นี้ไม่รองรับ Web Speech API' });
      return;
    }
    speakThai(targetText, {
      rate: form.value.rate,
      onStart: () => {
        webSpeechPlaying.value = true;
      },
      onEnd: () => {
        webSpeechPlaying.value = false;
      },
    });
    return;
  }

  if (!effectiveHasKey.value) {
    emit('notify', {
      type: 'error',
      text: 'กรุณากรอกหรือบันทึก Gemini API Key ก่อนทดลองฟังเสียง',
    });
    return;
  }

  const controller = new AbortController();
  previewController = controller;
  previewLoading.value = true;

  try {
    const payload = {
      text: targetText,
      model: String(form.value.model || '').trim(),
      voice: String(form.value.voice || '').trim(),
      temperature: Number(form.value.temperature),
      style_prompt: form.value.style_prompt,
    };
    if (apiKeyInput.value.trim()) {
      payload.api_key = apiKeyInput.value.trim();
    }

    const res = await api.previewSpeech(payload, controller.signal);
    if (previewController === controller) {
      previewController = null;
    }

    const blob = pcmBase64ToWavBlob(res.audio_base64, {
      mimeType: res.mime_type,
      sampleRate: res.sample_rate,
    });

    cleanupPlayerAudio();
    revokePreviewAudioUrl();

    const objectUrl = URL.createObjectURL(blob);
    previewAudioUrl.value = objectUrl;
    previewMeta.value = {
      model: payload.model,
      voice: payload.voice,
      sampleRate: res.sample_rate || 24000,
    };

    const audio = new Audio(objectUrl);
    audio.playbackRate = normalizeSpeechRate(form.value.rate);
    playerAudio = audio;

    audio.onloadedmetadata = () => {
      previewDuration.value = Number.isFinite(audio.duration) ? audio.duration : 0;
      audio.playbackRate = normalizeSpeechRate(form.value.rate);
    };
    audio.ontimeupdate = () => {
      previewCurrentTime.value = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    };
    audio.onplay = () => {
      audio.playbackRate = normalizeSpeechRate(form.value.rate);
      previewPlaying.value = true;
    };
    audio.onpause = () => {
      previewPlaying.value = false;
    };
    audio.onended = () => {
      previewPlaying.value = false;
      previewCurrentTime.value = 0;
    };
    let mediaErrorHandled = false;
    audio.onerror = () => {
      mediaErrorHandled = true;
      previewPlaying.value = false;
      emit('notify', { type: 'error', text: 'ไม่สามารถเล่นไฟล์เสียงตัวอย่างได้' });
    };

    try {
      await audio.play();
    } catch (playErr) {
      previewPlaying.value = false;
      if (playErr?.name !== 'NotAllowedError' && playErr?.name !== 'AbortError' && !mediaErrorHandled) {
        emit('notify', { type: 'error', text: 'ไม่สามารถเล่นไฟล์เสียงตัวอย่างได้' });
      }
    }
  } catch (err) {
    if (previewController === controller) {
      previewController = null;
    }
    if (err?.name !== 'AbortError') {
      emit('notify', { type: 'error', text: err.message });
    }
  } finally {
    previewLoading.value = false;
  }
}

function togglePreviewPlayPause() {
  if (!playerAudio) {
    return;
  }
  if (previewPlaying.value) {
    playerAudio.pause();
  } else {
    playerAudio.playbackRate = normalizeSpeechRate(form.value.rate);
    playerAudio.play().catch(() => {});
  }
}

function handleSeek(event) {
  if (!playerAudio) {
    return;
  }
  const nextTime = Number(event.target?.value || 0);
  if (Number.isFinite(nextTime)) {
    playerAudio.currentTime = nextTime;
    previewCurrentTime.value = nextTime;
  }
}

onMounted(() => {
  loadSettings();
});

onUnmounted(() => {
  stopPreviewPlayback();
  cleanupPlayerAudio();
  revokePreviewAudioUrl();
  apiKeyInput.value = '';
  showApiKey.value = false;
});
</script>

<template>
  <div v-if="loadingSettings" class="bg-white rounded-2xl border border-stone-200 p-8 text-center text-stone-500 text-sm">
    กำลังโหลดการตั้งค่าเสียงอ่านคิว...
  </div>

  <div v-else class="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
    <form class="lg:col-span-7 bg-white rounded-2xl border border-stone-200 p-4 md:p-5 space-y-5" @submit.prevent="saveSettings">
      <div class="flex items-start justify-between gap-3">
        <div class="flex items-center gap-2.5">
          <span class="w-10 h-10 rounded-xl bg-orange-50 text-brand flex items-center justify-center shrink-0">
            <Volume2 class="w-5 h-5" />
          </span>
          <div>
            <h2 class="font-bold text-stone-900 text-base md:text-lg">ตั้งค่าแหล่งเสียงอ่านคิว</h2>
            <p class="text-xs text-stone-500">
              กำหนดค่าเฉพาะ Admin — หน้าครัวจะใช้เสียงตามการตั้งค่านี้โดยอัตโนมัติ
            </p>
          </div>
        </div>
      </div>

      <div class="space-y-2">
        <span class="block text-xs font-bold text-stone-700">เลือก Source เสียง</span>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <button
            type="button"
            class="p-3.5 rounded-2xl border text-left transition space-y-1"
            :class="
              form.source === 'web_speech'
                ? 'border-brand bg-orange-50/80 ring-2 ring-brand/20'
                : 'border-stone-200 bg-stone-50 hover:bg-stone-100'
            "
            @click="form.source = 'web_speech'"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="font-bold text-sm text-stone-900">Google Translate (แบบเดิม)</span>
              <span
                v-if="form.source === 'web_speech'"
                class="w-5 h-5 rounded-full bg-brand text-white flex items-center justify-center shrink-0"
              >
                <Check class="w-3.5 h-3.5" />
              </span>
            </div>
            <p class="text-xs text-stone-500">
              เสียงภาษาไทยจากเบราว์เซอร์ / เครื่อง อ่านทันทีไม่ต้องใช้ API Key
            </p>
          </button>

          <button
            type="button"
            class="p-3.5 rounded-2xl border text-left transition space-y-1"
            :class="
              form.source === 'ai_studio'
                ? 'border-brand bg-orange-50/80 ring-2 ring-brand/20'
                : 'border-stone-200 bg-stone-50 hover:bg-stone-100'
            "
            @click="form.source = 'ai_studio'"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="font-bold text-sm text-stone-900 flex items-center gap-1.5">
                <Sparkles class="w-4 h-4 text-brand shrink-0" />
                <span>Google AI Studio</span>
              </span>
              <span
                v-if="form.source === 'ai_studio'"
                class="w-5 h-5 rounded-full bg-brand text-white flex items-center justify-center shrink-0"
              >
                <Check class="w-3.5 h-3.5" />
              </span>
            </div>
            <p class="text-xs text-stone-500">
              เสียง Gemini TTS สมจริง ปรับสไตล์ น้ำเสียง และพารามิเตอร์แบบ Playground
            </p>
          </button>
        </div>
      </div>

      <div v-if="form.source === 'web_speech'" class="p-4 rounded-2xl bg-stone-50 border border-stone-200 space-y-3">
        <div>
          <label class="block text-xs font-bold text-stone-700 mb-1.5" for="speech-rate-web">
            ความเร็วเสียงเริ่มต้นในครัว
          </label>
          <select
            id="speech-rate-web"
            v-model.number="form.rate"
            class="w-full min-h-11 px-3.5 rounded-xl border border-stone-300 bg-white text-sm font-semibold text-stone-800 tabular-nums"
          >
            <option v-for="rate in SPEECH_RATE_OPTIONS" :key="rate" :value="rate">
              {{ rate }}x
            </option>
          </select>
        </div>
        <p class="text-xs text-stone-500">
          ใช้เสียงสังเคราะห์ภาษาไทย (`th-TH`) ของอุปกรณ์ที่เปิดหน้ากระดานครัว ไม่มีค่าใช้จ่าย API
        </p>
      </div>

      <div v-else class="space-y-4">
        <div class="p-4 rounded-2xl bg-stone-50 border border-stone-200 space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <label class="text-xs font-bold text-stone-800 flex items-center gap-1.5" for="ai-studio-api-key">
              <KeyRound class="w-4 h-4 text-brand" />
              <span>Gemini API Key (Google AI Studio)</span>
            </label>

            <span
              v-if="clearApiKeyFlag"
              class="px-2.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[11px] font-bold"
            >
              จะล้างคีย์เมื่อกดบันทึก
            </span>
            <span
              v-else-if="hasApiKey"
              class="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold tabular-nums"
            >
              บันทึกแล้ว ({{ apiKeyMasked }})
            </span>
            <span
              v-else
              class="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-bold"
            >
              ยังไม่ได้ตั้งค่าคีย์
            </span>
          </div>

          <div class="flex items-center gap-2">
            <div class="relative flex-1">
              <input
                id="ai-studio-api-key"
                v-model="apiKeyInput"
                :type="showApiKey ? 'text' : 'password'"
                autocomplete="off"
                autocapitalize="off"
                spellcheck="false"
                :placeholder="hasApiKey ? 'กรอก API Key ใหม่เพื่อเปลี่ยน (ปล่อยว่างเพื่อใช้คีย์เดิม)' : 'วาง Gemini API Key จาก Google AI Studio'"
                class="w-full min-h-11 pl-3.5 pr-11 rounded-xl border border-stone-300 bg-white text-sm"
              />
              <button
                type="button"
                aria-label="แสดงหรือซ่อน API Key"
                class="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg text-stone-500 hover:bg-stone-100 flex items-center justify-center"
                @click="showApiKey = !showApiKey"
              >
                <EyeOff v-if="showApiKey" class="w-4 h-4" />
                <Eye v-else class="w-4 h-4" />
              </button>
            </div>

            <button
              v-if="hasApiKey"
              type="button"
              class="min-h-11 px-3 rounded-xl border text-xs font-bold flex items-center gap-1 shrink-0"
              :class="
                clearApiKeyFlag
                  ? 'border-stone-300 bg-white text-stone-700 hover:bg-stone-100'
                  : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
              "
              @click="toggleClearApiKey"
            >
              <Trash2 class="w-4 h-4" />
              <span>{{ clearApiKeyFlag ? 'ยกเลิกล้าง' : 'ล้างคีย์' }}</span>
            </button>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-2 pt-0.5">
            <p class="text-[11px] text-stone-500">
              API Key เก็บและเรียกใช้งานบนเซิร์ฟเวอร์เท่านั้น ไม่ส่งคีย์จริงกลับมายังเบราว์เซอร์
            </p>
            <button
              type="button"
              :disabled="catalogLoading || !effectiveHasKey"
              class="min-h-9 px-3 rounded-xl border border-orange-200 bg-orange-50 hover:bg-orange-100 text-brand-dark text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"
              @click="loadCatalog({ silent: false })"
            >
              <RefreshCw class="w-3.5 h-3.5" :class="{ 'animate-spin': catalogLoading }" />
              <span>{{ catalogLoading ? 'กำลังโหลดจาก API...' : 'โหลดโมเดล & เสียงจาก API' }}</span>
            </button>
          </div>

          <p v-if="catalogError" class="text-xs text-red-600 font-medium">
            {{ catalogError }}
          </p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div class="space-y-1.5">
            <div class="flex items-center justify-between gap-2">
              <label class="text-xs font-bold text-stone-700" for="ai-studio-model">
                Model
              </label>
              <button
                type="button"
                class="text-[11px] font-semibold text-brand hover:text-brand-dark"
                @click="customModelMode = !customModelMode"
              >
                {{ customModelMode ? 'เลือกจากรายการ' : 'ระบุชื่อเอง' }}
              </button>
            </div>

            <input
              v-if="customModelMode || modelOptions.length === 0"
              id="ai-studio-model"
              v-model="form.model"
              type="text"
              maxlength="100"
              placeholder="เช่น gemini-2.5-flash-preview-tts"
              class="w-full min-h-11 px-3.5 rounded-xl border border-stone-300 bg-white text-sm"
            />
            <select
              v-else
              id="ai-studio-model"
              v-model="form.model"
              class="w-full min-h-11 px-3 rounded-xl border border-stone-300 bg-white text-sm font-medium text-stone-800"
            >
              <option v-for="model in modelOptions" :key="model.id" :value="model.id">
                {{ model.display_name }} ({{ model.id }})
              </option>
            </select>
            <p v-if="!catalogLoaded && models.length === 0" class="text-[11px] text-stone-500">
              กด "โหลดโมเดล & เสียงจาก API" เพื่อดึงรายการโมเดล TTS ล่าสุดจากบัญชีของคุณ
            </p>
          </div>

          <div class="space-y-1.5">
            <div class="flex items-center justify-between gap-2">
              <label class="text-xs font-bold text-stone-700" for="ai-studio-voice">
                Voice
              </label>
              <span class="text-[11px] font-medium text-stone-500">
                {{ voicesSource === 'api' ? 'จาก Gemini API' : 'ชุดเสียงมาตรฐาน' }}
              </span>
            </div>

            <select
              id="ai-studio-voice"
              v-model="form.voice"
              class="w-full min-h-11 px-3 rounded-xl border border-stone-300 bg-white text-sm font-medium text-stone-800"
            >
              <option v-for="voice in voiceOptions" :key="voice.name" :value="voice.name">
                {{ voice.display_name }}{{ voice.description ? ` — ${voice.description}` : '' }}
              </option>
            </select>
            <p v-if="selectedVoiceInfo?.description" class="text-[11px] text-stone-500">
              โทนเสียง: {{ selectedVoiceInfo.description }}
            </p>
          </div>
        </div>

        <div class="space-y-2">
          <div class="flex items-center justify-between gap-2">
            <label class="text-xs font-bold text-stone-700" for="ai-studio-style">
              Style Instructions (คำสั่งกำหนดสไตล์และน้ำเสียง)
            </label>
            <span class="text-[11px] text-stone-400 tabular-nums">
              {{ form.style_prompt.length }}/400
            </span>
          </div>
          <textarea
            id="ai-studio-style"
            v-model="form.style_prompt"
            rows="2"
            maxlength="400"
            placeholder="เช่น พูดภาษาไทยให้ชัดเจน สดใส เป็นกันเอง เหมือนพนักงานเรียกคิวหน้าร้าน"
            class="w-full px-3.5 py-2.5 rounded-xl border border-stone-300 bg-white text-sm resize-y"
          />
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="preset in SPEECH_STYLE_PRESETS"
              :key="preset.label"
              type="button"
              class="min-h-8 px-2.5 rounded-lg border border-stone-200 bg-stone-50 hover:bg-orange-50 hover:border-orange-200 hover:text-brand-dark text-[11px] font-semibold text-stone-700 transition"
              @click="form.style_prompt = preset.prompt"
            >
              {{ preset.label }}
            </button>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
          <div class="p-3 rounded-xl bg-stone-50 border border-stone-200 space-y-2">
            <div class="flex items-center justify-between gap-2">
              <label class="text-xs font-bold text-stone-700" for="ai-studio-temp">
                Temperature
              </label>
              <span class="px-2 py-0.5 rounded-md bg-white border border-stone-200 text-xs font-bold text-stone-800 tabular-nums">
                {{ Number(form.temperature).toFixed(1) }}
              </span>
            </div>
            <input
              id="ai-studio-temp"
              v-model.number="form.temperature"
              type="range"
              min="0"
              max="2"
              step="0.1"
              class="w-full accent-brand cursor-pointer"
            />
            <div class="flex justify-between text-[10px] text-stone-400 tabular-nums">
              <span>0.0 (คงที่)</span>
              <span>1.0</span>
              <span>2.0 (อารมณ์หลากหลาย)</span>
            </div>
          </div>

          <div class="p-3 rounded-xl bg-stone-50 border border-stone-200 space-y-2">
            <label class="block text-xs font-bold text-stone-700" for="speech-rate-ai">
              ความเร็วในการเล่น (Playback Speed)
            </label>
            <select
              id="speech-rate-ai"
              v-model.number="form.rate"
              class="w-full min-h-10 px-3 rounded-xl border border-stone-300 bg-white text-sm font-semibold text-stone-800 tabular-nums"
            >
              <option v-for="rate in SPEECH_RATE_OPTIONS" :key="rate" :value="rate">
                {{ rate }}x
              </option>
            </select>
            <p class="text-[11px] text-stone-500">
              ปรับความเร็วเสียงอ่านคิวบนหน้าจอครัว
            </p>
          </div>
        </div>
      </div>

      <button
        type="submit"
        :disabled="saving"
        class="w-full min-h-11 rounded-xl bg-brand hover:bg-brand-dark text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
      >
        <Loader2 v-if="saving" class="w-4 h-4 animate-spin" />
        <Check v-else class="w-4 h-4" />
        <span>{{ saving ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่าเสียง' }}</span>
      </button>
    </form>

    <section class="lg:col-span-5 bg-white rounded-2xl border border-stone-200 p-4 md:p-5 space-y-4">
      <div class="flex items-center justify-between gap-2">
        <div>
          <h3 class="font-bold text-stone-900 text-base">Playground Preview</h3>
          <p class="text-xs text-stone-500">
            ทดลองสร้างและฟังเสียงด้วยค่าที่ตั้งไว้ด้านซ้ายก่อนบันทึกได้ทันที
          </p>
        </div>
        <span
          class="px-2.5 py-1 rounded-full text-[11px] font-bold shrink-0"
          :class="
            form.source === 'ai_studio'
              ? 'bg-orange-100 text-brand-dark'
              : 'bg-stone-100 text-stone-700'
          "
        >
          {{ form.source === 'ai_studio' ? 'AI Studio' : 'Google เดิม' }}
        </span>
      </div>

      <div class="space-y-1.5">
        <div class="flex items-center justify-between gap-2">
          <label class="text-xs font-bold text-stone-700" for="speech-preview-text">
            ข้อความทดสอบอ่านคิว
          </label>
          <button
            type="button"
            class="text-xs font-semibold text-stone-500 hover:text-brand flex items-center gap-1"
            @click="previewText = DEFAULT_PREVIEW_TEXT"
          >
            <RotateCcw class="w-3 h-3" />
            <span>ใช้ข้อความตัวอย่าง</span>
          </button>
        </div>
        <textarea
          id="speech-preview-text"
          v-model="previewText"
          rows="4"
          maxlength="500"
          placeholder="พิมพ์ข้อความที่ต้องการทดลองฟัง..."
          class="w-full px-3.5 py-2.5 rounded-xl border border-stone-300 bg-stone-50/50 text-sm resize-y"
        />
      </div>

      <div class="flex items-center gap-2">
        <button
          type="button"
          :disabled="previewLoading"
          class="flex-1 min-h-11 px-4 rounded-xl bg-stone-900 hover:bg-stone-800 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
          @click="runPreview()"
        >
          <Loader2 v-if="previewLoading" class="w-4 h-4 animate-spin" />
          <Play v-else class="w-4 h-4" />
          <span>{{ previewLoading ? 'กำลังสร้างเสียง...' : 'สร้างและทดลองฟัง (Preview)' }}</span>
        </button>

        <button
          v-if="previewPlaying || webSpeechPlaying || previewLoading"
          type="button"
          class="min-h-11 px-3.5 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 font-bold text-sm flex items-center justify-center gap-1.5 shrink-0"
          @click="stopPreviewPlayback"
        >
          <Square class="w-4 h-4" />
          <span>หยุด</span>
        </button>
      </div>

      <div
        v-if="form.source === 'web_speech' && webSpeechPlaying"
        class="p-3.5 rounded-xl bg-orange-50 border border-orange-200 text-xs font-bold text-brand-dark flex items-center gap-2"
      >
        <Volume2 class="w-4 h-4 shrink-0" />
        <span>กำลังอ่านตัวอย่างด้วย Google Translate / เสียงเครื่อง ({{ form.rate }}x)</span>
      </div>

      <div
        v-if="previewAudioUrl && form.source === 'ai_studio'"
        class="p-4 rounded-2xl bg-stone-50 border border-stone-200 space-y-3"
      >
        <div class="flex items-center justify-between gap-2 text-xs">
          <span class="font-bold text-stone-800">Audio Output</span>
          <span v-if="previewMeta" class="text-stone-500 tabular-nums">
            {{ previewMeta.voice }} • {{ previewMeta.model }}
          </span>
        </div>

        <div class="flex items-center gap-2.5">
          <button
            type="button"
            class="w-10 h-10 rounded-xl bg-brand hover:bg-brand-dark text-white flex items-center justify-center shrink-0"
            @click="togglePreviewPlayPause"
          >
            <Pause v-if="previewPlaying" class="w-4 h-4" />
            <Play v-else class="w-4 h-4" />
          </button>

          <input
            type="range"
            min="0"
            :max="previewDuration || 0"
            step="0.05"
            :value="previewCurrentTime"
            aria-label="ตำแหน่งเวลาเสียงตัวอย่าง"
            class="flex-1 accent-brand cursor-pointer"
            @input="handleSeek"
          />

          <span class="text-xs font-semibold text-stone-600 tabular-nums shrink-0">
            {{ formatSeconds(previewCurrentTime) }} / {{ formatSeconds(previewDuration) }}
          </span>
        </div>

        <div class="pt-1 border-t border-stone-200/80">
          <span class="text-[11px] text-stone-500 tabular-nums">
            ความเร็วเล่น {{ form.rate }}x • {{ previewMeta?.sampleRate || 24000 }} Hz WAV
          </span>
        </div>
      </div>
    </section>
  </div>
</template>
