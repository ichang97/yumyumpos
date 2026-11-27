export const DEFAULT_SPEECH_RATE = 1.15;
export const SPEECH_RATE_OPTIONS = [0.9, 1.0, 1.15, 1.3, 1.5, 1.75, 2.0];
export const DEFAULT_PREVIEW_TEXT =
  'คิวที่ 005 ทานที่ร้าน ยำมาม่าหมูสับ เผ็ดกลาง 2 ที่ หมายเหตุ ไม่ใส่ผักชี';

export const SPEECH_STYLE_PRESETS = [
  {
    label: 'สดใส เป็นกันเอง',
    prompt: 'พูดภาษาไทยให้ชัดเจน น้ำเสียงสดใส เป็นกันเอง และกระชับ เหมือนพนักงานเรียกคิวหน้าร้าน',
  },
  {
    label: 'สุภาพ ชัดเจน',
    prompt: 'พูดภาษาไทยด้วยน้ำเสียงสุภาพ ชัดถ้อยชัดคำ จังหวะพอดี ฟังง่าย',
  },
  {
    label: 'เร่งด่วน กระชับ',
    prompt: 'อ่านคิวอาหารภาษาไทยให้กระชับ คล่องแคล่ว ชัดเจน สำหรับครัวในช่วงเวลาเร่งด่วน',
  },
  {
    label: 'นุ่มนวล ใจเย็น',
    prompt: 'พูดภาษาไทยด้วยน้ำเสียงนุ่มนวล อบอุ่น และผ่อนคลาย',
  },
];

const MAX_AUDIO_CACHE = 25;

let activeUtterance = null;
let activeAudio = null;
let activeAbortController = null;
let playSeq = 0;
const audioCache = new Map();

export function normalizeSpeechRate(value) {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    return DEFAULT_SPEECH_RATE;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return DEFAULT_SPEECH_RATE;
  }
  return Math.round(Math.min(2, Math.max(0.8, num)) * 100) / 100;
}

export function isSpeechSupported() {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof SpeechSynthesisUtterance !== 'undefined'
  );
}

export function clearSpeechAudioCache() {
  if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    for (const url of audioCache.values()) {
      URL.revokeObjectURL(url);
    }
  }
  audioCache.clear();
}

function setCachedAudioUrl(key, url) {
  if (audioCache.has(key)) {
    audioCache.delete(key);
  } else if (audioCache.size >= MAX_AUDIO_CACHE) {
    const oldest = audioCache.entries().next().value;
    if (oldest) {
      audioCache.delete(oldest[0]);
      if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(oldest[1]);
      }
    }
  }
  audioCache.set(key, url);
}

export function pcmBase64ToWavBlob(
  base64Data,
  { mimeType = 'audio/L16;codec=pcm;rate=24000', sampleRate = 24000 } = {}
) {
  const binary = atob(String(base64Data || ''));
  const pcmBytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    pcmBytes[i] = binary.charCodeAt(i);
  }

  const baseMime = String(mimeType || '').split(';')[0].trim().toLowerCase();
  if (
    baseMime === 'audio/wav' ||
    baseMime === 'audio/wave' ||
    baseMime === 'audio/x-wav' ||
    baseMime === 'audio/mpeg' ||
    baseMime === 'audio/mp3' ||
    baseMime === 'audio/ogg' ||
    baseMime === 'audio/webm'
  ) {
    return new Blob([pcmBytes], { type: baseMime });
  }

  const rate = Number.isInteger(Number(sampleRate)) && Number(sampleRate) > 0 ? Number(sampleRate) : 24000;
  const headerSize = 44;
  const wavBuffer = new ArrayBuffer(headerSize + pcmBytes.length);
  const view = new DataView(wavBuffer);
  const wavBytes = new Uint8Array(wavBuffer);

  const writeAscii = (offset, str) => {
    for (let i = 0; i < str.length; i += 1) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + pcmBytes.length, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, pcmBytes.length, true);
  wavBytes.set(pcmBytes, headerSize);

  return new Blob([wavBytes], { type: 'audio/wav' });
}

export function stopSpeech() {
  playSeq += 1;
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
  }
  if (activeAudio) {
    activeAudio.onplay = null;
    activeAudio.onended = null;
    activeAudio.onerror = null;
    try {
      activeAudio.pause();
      activeAudio.removeAttribute('src');
      activeAudio.load();
    } catch {
    }
    activeAudio = null;
  }
  activeUtterance = null;
  if (isSpeechSupported()) {
    window.speechSynthesis.cancel();
  }
}

export function speakThai(text, { rate = DEFAULT_SPEECH_RATE, onStart, onEnd } = {}) {
  const cleaned = String(text || '').trim();
  if (!cleaned || !isSpeechSupported()) {
    return false;
  }

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(cleaned);
  utterance.lang = 'th-TH';
  utterance.rate = normalizeSpeechRate(rate);

  const voices =
    typeof window.speechSynthesis.getVoices === 'function'
      ? window.speechSynthesis.getVoices()
      : [];
  const thaiVoice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('th'));
  if (thaiVoice) {
    utterance.voice = thaiVoice;
  }

  activeUtterance = utterance;

  utterance.onstart = () => {
    if (typeof onStart === 'function') {
      onStart();
    }
  };

  const finish = () => {
    if (activeUtterance === utterance) {
      activeUtterance = null;
    }
    if (typeof onEnd === 'function') {
      onEnd();
    }
  };

  utterance.onend = finish;
  utterance.onerror = finish;

  window.speechSynthesis.speak(utterance);
  return true;
}

export function speakOrderAudio(
  text,
  { source = 'web_speech', rate = DEFAULT_SPEECH_RATE, fetchAudio, onLoading, onStart, onEnd, onFallback } = {}
) {
  const cleaned = String(text || '').trim();
  if (!cleaned) {
    return false;
  }

  stopSpeech();

  if (source !== 'ai_studio' || typeof fetchAudio !== 'function' || typeof Audio === 'undefined') {
    return speakThai(cleaned, { rate, onStart, onEnd });
  }

  const seq = ++playSeq;
  const normalizedRate = normalizeSpeechRate(rate);

  (async () => {
    let objectUrl = audioCache.get(cleaned) || '';
    if (objectUrl) {
      setCachedAudioUrl(cleaned, objectUrl);
    } else {
      if (typeof onLoading === 'function') {
        onLoading();
      }
      const controller = new AbortController();
      activeAbortController = controller;
      try {
        const res = await fetchAudio(cleaned, controller.signal);
        if (activeAbortController === controller) {
          activeAbortController = null;
        }
        if (seq !== playSeq) {
          return;
        }
        const blob = pcmBase64ToWavBlob(res.audio_base64, {
          mimeType: res.mime_type,
          sampleRate: res.sample_rate,
        });
        objectUrl = URL.createObjectURL(blob);
        setCachedAudioUrl(cleaned, objectUrl);
      } catch (err) {
        if (activeAbortController === controller) {
          activeAbortController = null;
        }
        if (err?.name === 'AbortError' || seq !== playSeq) {
          return;
        }
        if (typeof onFallback === 'function') {
          onFallback(err);
        }
        const fallbackStarted = speakThai(cleaned, { rate: normalizedRate, onStart, onEnd });
        if (!fallbackStarted && typeof onEnd === 'function') {
          onEnd();
        }
        return;
      }
    }

    if (seq !== playSeq) {
      return;
    }

    const audio = new Audio(objectUrl);
    audio.playbackRate = normalizedRate;
    activeAudio = audio;

    let started = false;
    const finishAudio = () => {
      if (activeAudio === audio) {
        activeAudio = null;
      }
      if (typeof onEnd === 'function') {
        onEnd();
      }
    };

    audio.onplay = () => {
      started = true;
      if (typeof onStart === 'function') {
        onStart();
      }
    };
    audio.onended = finishAudio;
    audio.onerror = () => {
      if (activeAudio === audio) {
        activeAudio = null;
      }
      if (seq !== playSeq) {
        return;
      }
      if (!started) {
        if (typeof onFallback === 'function') {
          onFallback(new Error('ไม่สามารถเล่นไฟล์เสียงได้'));
        }
        const fallbackStarted = speakThai(cleaned, { rate: normalizedRate, onStart, onEnd });
        if (!fallbackStarted && typeof onEnd === 'function') {
          onEnd();
        }
        return;
      }
      if (typeof onEnd === 'function') {
        onEnd();
      }
    };

    try {
      await audio.play();
    } catch (err) {
      if (activeAudio === audio) {
        activeAudio = null;
      }
      if (seq !== playSeq || err?.name === 'AbortError') {
        return;
      }
      if (typeof onFallback === 'function') {
        onFallback(err);
      }
      const fallbackStarted = speakThai(cleaned, { rate: normalizedRate, onStart, onEnd });
      if (!fallbackStarted && typeof onEnd === 'function') {
        onEnd();
      }
    }
  })();

  return true;
}

export function buildOrderSpeechText(order) {
  if (!order) {
    return '';
  }

  const queueLabel = order.queue_no
    ? `คิวที่ ${order.queue_no}`
    : order.order_no
      ? `ออเดอร์ ${order.order_no}`
      : '';
  const orderTypeLabel = order.order_type === 'dine_in' ? 'ทานที่ร้าน' : 'กลับบ้าน';

  const itemsText = (Array.isArray(order.items) ? order.items : [])
    .map((item) => {
      const parts = [String(item.menu_name || '').trim()];
      const optionText = (Array.isArray(item.options) ? item.options : [])
        .map((o) => String(o.option_name || '').trim())
        .filter(Boolean)
        .join(' ');
      if (optionText) {
        parts.push(optionText);
      }
      const qty = Number(item.quantity) || 1;
      if (qty > 1) {
        parts.push(`${qty} ที่`);
      }
      const noteText = String(item.note || '').trim();
      if (noteText) {
        parts.push(`หมายเหตุ ${noteText}`);
      }
      return parts.filter(Boolean).join(' ');
    })
    .filter(Boolean)
    .join(', ');

  return [queueLabel, orderTypeLabel, itemsText].filter(Boolean).join(' ').trim();
}

export function resolveNextOrderToAnnounce(prevStatusById, nextOrders, announcedIds) {
  const prevMap = prevStatusById instanceof Map ? prevStatusById : new Map();
  const nextList = Array.isArray(nextOrders) ? nextOrders : [];
  const announced = announcedIds instanceof Set ? announcedIds : new Set();

  let prevActiveCount = 0;
  for (const status of prevMap.values()) {
    if (status === 'pending' || status === 'cooking') {
      prevActiveCount += 1;
    }
  }

  const nextPending = nextList.filter((o) => o.kitchen_status === 'pending');
  const nextStatusById = new Map(nextList.map((o) => [o.id, o.kitchen_status]));

  if (prevActiveCount === 0 && nextPending.length > 0) {
    return nextPending.find((o) => !announced.has(o.id)) || null;
  }

  let finishedActiveOrder = false;
  for (const [id, prevStatus] of prevMap.entries()) {
    if (prevStatus === 'pending' || prevStatus === 'cooking') {
      const nextStatus = nextStatusById.get(id);
      if (nextStatus === 'ready' || nextStatus === undefined) {
        finishedActiveOrder = true;
        break;
      }
    }
  }

  if (finishedActiveOrder && nextPending.length > 0) {
    return nextPending.find((o) => !announced.has(o.id)) || null;
  }

  return null;
}
