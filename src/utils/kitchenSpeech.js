export const DEFAULT_SPEECH_RATE = 1.15;
export const SPEECH_RATE_OPTIONS = [0.9, 1.0, 1.15, 1.3, 1.5, 1.75, 2.0];

let activeUtterance = null;

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

export function stopSpeech() {
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
